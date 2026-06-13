import * as crypto from 'crypto';
import { executeNonLlmTool } from '../WorkflowNonLlmToolRunner';
import { applyPreStageQualityGates } from '../WorkflowStagePreGates';
import { isContractNode } from '../HITLContractNodePolicy';
import type { ExecuteNextStageLoopParams, StageStepOutcome } from '../WorkflowExecutorTypes';
import { finalizeStageAfterToolRun } from './StagePostRunPipeline';
import { buildStageStepContext } from './StageStepContext';
import { effectivePauseAfterForStage, markStageRunning, runStagePrelude } from './StagePrelude';
import { runLlmTextStage } from './LlmTextStageRunner';
import { isImplStageId, isTestRunStageId } from '../workflow/StageIdPatterns';
import { isLlmTextTool } from '../workflow/StageToolKinds';
import { stageRunnerMsg } from '../l10n/gateMsg';
import { handleStageExecutionError } from './StageErrorHandler';
import { isStageAlreadyHandledError } from './StageControlSignals';

/** 执行单个阶段（不修改 currentStageIndex）。 */
export async function executeStageStep(
  params: ExecuteNextStageLoopParams,
  stageIndex: number,
): Promise<StageStepOutcome> {
  const ctx = buildStageStepContext(params, stageIndex);
  const { stage, runtime, instance, panel } = ctx;
  const {
    currentInstanceKey,
    setCurrentInstanceKey,
    primaryOutputKey,
    ensureTaskDir,
    resolveTaskFilePath,
    resolveOutputPath,
    resolveReadableFilePath,
    runCodeRunner,
    trackPersistedFile,
  } = params;

  const preludeOutcome = await runStagePrelude(ctx);
  if (preludeOutcome !== null) {
    return preludeOutcome;
  }

  const attempt = markStageRunning(ctx);

  try {
    const outKey = primaryOutputKey(stage);
    const instanceKey = currentInstanceKey ?? crypto.randomUUID();
    setCurrentInstanceKey(instanceKey);
    ensureTaskDir(instanceKey);

    if (isLlmTextTool(stage.tool)) {
      await runLlmTextStage(ctx, attempt, instanceKey);
    } else {
      if (isTestRunStageId(stage.id)) {
        const gateTest = await applyPreStageQualityGates(params, stage, stageIndex, 'before-test-run', attempt);
        if (gateTest === 'failed') {
          return 'failed';
        }
        if (gateTest === 'replan') {
          if (runtime.status === 'running' || runtime.status === 'retrying') {
            runtime.status = 'pending';
          }
          return 'replan';
        }
      }
      const handled = await executeNonLlmTool({
        stage,
        runtime,
        outKey,
        instance,
        instanceKey,
        resolveTaskFilePath,
        resolveOutputPath,
        resolveReadableFilePath,
        runCodeRunner,
        stageIndex,
        trackPersistedFile,
        warn: params.warn,
      });
      if (!handled) {
        throw new Error(stageRunnerMsg('toolNotImplemented', stage.tool));
      }
    }

    return finalizeStageAfterToolRun({
      params,
      stage,
      runtime,
      instance,
      effectivePauseAfter: effectivePauseAfterForStage(ctx),
      outKey,
      attempt,
      contractNode: isContractNode(instance.definition, stage),
    });
  } catch (e) {
    // 阶段已自行处理失败（postStageError + status=failed），按 failed 收尾，勿二次上报。
    if (isStageAlreadyHandledError(e)) {
      return 'failed';
    }
    return handleStageExecutionError(ctx, e, attempt);
  }
}
