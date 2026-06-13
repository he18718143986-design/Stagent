import { isFixIfFailedStageId } from '../runtime-replan/FixExhaustedRouter';
import { isRuntimeReplanTestFixStageId } from '../runtime-replan/constants';
import { isImplStageId, isTestWriteStageId } from '../workflow/StageIdPatterns';
import type { ToolPathBase } from '../WorkflowDefinition';
import {
  QUALITY_SCORE_OUTPUT_KEY,
  scoreStatically,
} from '../OutputQualityScorer';
import {
  buildConfidenceSignals,
  computeConfidence,
  CONFIDENCE_OUTPUT_KEY,
} from '../ConfidenceScorer';
import { DEFAULT_CONFIDENCE_PAUSE_THRESHOLD } from '../StagentSettingsDefaults';
import { applyModuleDepthPenaltyToQualityScore } from '../ModuleDepthScorer';
import { resolvePriorFailurePattern } from '../PriorFailurePatternResolver';
import {
  DEBUG_EVENT_CONFIDENCE_SCORED,
  DEBUG_EVENT_POST_IMPL_STATIC_ANALYSIS,
  DEBUG_EVENT_POST_IMPL_STATIC_ANALYSIS_ERROR,
  DEBUG_EVENT_POST_STAGE_QUALITY_GATE_ERROR,
  DEBUG_EVENT_MUTATE_GATE_RETRY,
  DEBUG_EVENT_TEST_WRITE_GATE_RETRY,
  debugEventForQualityGate,
} from '../DebugLogEvents';
import type { PanelLike } from '../WorkflowExecutorTypes';
import { runQualityGates } from '../QualityGateRunner';
import { failWorkflowStageFromGate } from '../WorkflowStageGateFailure';
import {
  MAX_TEST_WRITE_GATE_RETRIES,
  readTestWriteGateRetryState,
  recordTestWriteGateRetry,
  TestWriteGateBlockedError,
} from './llm-persist/testWriteGateRetry';
import {
  isMutateAuthoringStageId,
  MAX_MUTATE_GATE_RETRIES,
  MutateGateBlockedError,
  readMutateGateRetryState,
  recordMutateGateRetry,
} from './llm-persist/mutateGateRetry';
import { StageAlreadyHandledError, type StageHandledReason } from './StageControlSignals';
import type { StageStepContext } from './StageStepContext';

export async function scoreLlmTextConfidenceAndGates(
  ctx: StageStepContext,
  attempt: number,
  instanceKey: string,
  panel: PanelLike,
): Promise<void> {
  const { params, stage, runtime, instance } = ctx;
  const { postMessage, debugLog, primaryOutputKey: primaryKey, confidencePauseThreshold } = params;
  const { definition } = instance;
  const tc = stage.toolConfig as {
    type: 'llm-text';
    writeOutputToFile?: string;
    writePathBase?: ToolPathBase;
  };
  const outKey = primaryKey(stage);

  let quality = scoreStatically(stage, String(runtime.outputs[outKey] ?? ''), definition);
  if (
    params.architectureDepthScoringEnabled &&
    isImplStageId(stage.id) &&
    !stage.patchMode &&
    tc.writeOutputToFile &&
    /\.py$/i.test(tc.writeOutputToFile)
  ) {
    quality = applyModuleDepthPenaltyToQualityScore(quality, String(runtime.outputs[outKey] ?? ''));
  }
  runtime.outputs[QUALITY_SCORE_OUTPUT_KEY] = quality;

  const priorPattern = await resolvePriorFailurePattern({
    taskType: definition.meta.taskType,
    stageId: stage.id,
    workspaceRoot: params.getWorkspaceRoot?.(),
    enabled: params.memoryExperienceEnabled ?? false,
    warn: params.warnOnExperienceReadFailure,
  });
  const confidence = computeConfidence(
    buildConfidenceSignals(
      stage,
      runtime,
      outKey,
      String(runtime.outputs[outKey] ?? ''),
      quality,
      { priorFailurePattern: priorPattern },
    ),
  );
  runtime.outputs[CONFIDENCE_OUTPUT_KEY] = confidence;
  const pauseThreshold = confidencePauseThreshold ?? DEFAULT_CONFIDENCE_PAUSE_THRESHOLD;
  debugLog(stage.id, DEBUG_EVENT_CONFIDENCE_SCORED, attempt, {
    score: confidence.score,
    level: confidence.level,
    pauseThreshold,
    belowPauseThreshold: confidence.score < pauseThreshold,
    priorFailurePattern: priorPattern,
  });
  postMessage(panel, {
    type: 'stageConfidenceUpdate',
    stageId: stage.id,
    score: confidence.score,
    level: confidence.level,
    reasons: confidence.reasons,
  });

  if (isTestAuthoringStageId(stage.id)) {
    await runPostStageGatesWithBlock(ctx, attempt, instanceKey, 'post-test-write-quality-gate-failed');
  } else if (isImplStageId(stage.id) || isFixIfFailedStageId(stage.id)) {
    await runPostStageGatesWithBlock(ctx, attempt, instanceKey, 'post-mutate-quality-gate-failed');
  }
}

/** test_write 与 testfix replan 都是「测试作者」阶段：共用质量门禁 + 同 stage 重试。 */
function isTestAuthoringStageId(stageId: string): boolean {
  return isTestWriteStageId(stageId) || isRuntimeReplanTestFixStageId(stageId);
}

async function runPostStageGatesWithBlock(
  ctx: StageStepContext,
  attempt: number,
  instanceKey: string,
  handledReason: StageHandledReason,
): Promise<void> {
  const { params, stage, runtime, instance } = ctx;
  const { debugLog } = params;
  const host = params.qualityGateExecutionHost;
  if (!host) {
    if (isImplStageId(stage.id) && params.postImplStaticAnalysis) {
      try {
        const analysisWarnings = await params.postImplStaticAnalysis(stage);
        if (analysisWarnings.length > 0) {
          debugLog(stage.id, DEBUG_EVENT_POST_IMPL_STATIC_ANALYSIS, attempt, { warnings: analysisWarnings });
        }
      } catch (e) {
        debugLog(stage.id, DEBUG_EVENT_POST_IMPL_STATIC_ANALYSIS_ERROR, attempt, {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return;
  }
  try {
    const summary = await runQualityGates(
      'post-stage',
      {
        phase: 'post-stage',
        workflow: instance.definition,
        stage,
        stageIndex: ctx.stageIndex,
        stageRuntime: runtime,
        instance,
        instanceKey,
        taskWorkspaceAbs: params.getWorkspaceRoot?.(),
        executionHost: host,
      },
      { stopOnBlock: true, severities: ['block', 'warn', 'info'] },
    );
    for (const w of summary.warnings) {
      debugLog(stage.id, debugEventForQualityGate(w.gateId), attempt, { messages: w.messages });
    }
    if (summary.blocks.length > 0) {
      const block = summary.blocks[0]!;
      const messages = block.messages.length ? block.messages : ['quality gate blocked'];
      // P1：test_write gate block → 同 stage 带 gate 反馈重写测试（≤ MAX 次），
      // 因 fix 链不可改 test，此处是结构性唯一修复点（T4 Run #22）。
      if (isTestAuthoringStageId(stage.id)) {
        const state = readTestWriteGateRetryState(runtime.outputs);
        if (state.attempts < MAX_TEST_WRITE_GATE_RETRIES) {
          const next = recordTestWriteGateRetry(runtime.outputs, messages);
          debugLog(stage.id, DEBUG_EVENT_TEST_WRITE_GATE_RETRY, attempt, {
            gateId: block.gateId,
            retryAttempt: next.attempts,
            maxRetries: MAX_TEST_WRITE_GATE_RETRIES,
            messages,
          });
          throw new TestWriteGateBlockedError(messages);
        }
      }
      // P2（T4 Run #26）：impl/fix post-mutate gate block → 同 stage 带反馈重写（≤ MAX 次）。
      if (isMutateAuthoringStageId(stage.id)) {
        const state = readMutateGateRetryState(runtime.outputs);
        if (state.attempts < MAX_MUTATE_GATE_RETRIES) {
          const next = recordMutateGateRetry(runtime.outputs, messages);
          debugLog(stage.id, DEBUG_EVENT_MUTATE_GATE_RETRY, attempt, {
            gateId: block.gateId,
            retryAttempt: next.attempts,
            maxRetries: MAX_MUTATE_GATE_RETRIES,
            messages,
          });
          throw new MutateGateBlockedError(messages);
        }
      }
      const reason = messages.join('; ');
      failWorkflowStageFromGate(params, stage, ctx.stageIndex, reason);
      throw new StageAlreadyHandledError(handledReason);
    }
  } catch (e) {
    if (
      e instanceof StageAlreadyHandledError ||
      e instanceof TestWriteGateBlockedError ||
      e instanceof MutateGateBlockedError
    ) {
      throw e;
    }
    debugLog(stage.id, DEBUG_EVENT_POST_STAGE_QUALITY_GATE_ERROR, attempt, {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
