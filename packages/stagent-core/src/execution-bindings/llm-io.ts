import type * as vscode from '../platform/HostTypes';
import { resolveEffectiveEnableDagScheduler } from '../EffectiveSettings';
import type { ExecuteNextStageLoopParams } from '../WorkflowExecutor';
import type { ExecutionLlmHost, ExecutionPathHost, ExecutionQualityHost } from './types';

export function buildLlmIoBindings(
  engine: ExecutionLlmHost & ExecutionPathHost & ExecutionQualityHost,
  targetPanel: vscode.WebviewPanel,
): Pick<
  ExecuteNextStageLoopParams,
  | 'primaryOutputKey'
  | 'ensureTaskDir'
  | 'resolveInput'
  | 'executeLlmText'
  | 'applyPatchInstructions'
  | 'resolveTaskFilePath'
  | 'resolveOutputPath'
  | 'resolveReadableFilePath'
  | 'runCodeRunner'
  | 'trackPersistedFile'
> {
  const e = engine;
  return {
    primaryOutputKey: (stage) => e.primaryOutputKey(stage),
    ensureTaskDir: (instanceKey) => {
      e.ensureTaskDir(instanceKey);
    },
    resolveInput: (stage, runtime, p) => e.resolveInput(stage, runtime, p as vscode.WebviewPanel),
    executeLlmText: (stageId, sys, user, p) => {
      const stage = e.instance!.definition.stages.find((s) => s.id === stageId);
      const runtime = e.instance!.stageRuntimes.find((r) => r.stageId === stageId);
      const augmented =
        stage && runtime ? e.augmentSystemPromptWithGlobalDecisions(stage, runtime, sys) : sys;
      return e.executeLlmText(stageId, augmented, user, p as vscode.WebviewPanel);
    },
    applyPatchInstructions: (instanceKey, instructions, runtime, outKey) =>
      e.applyPatchInstructions(instanceKey, instructions, runtime, outKey),
    resolveTaskFilePath: (instanceKey, relativePath) => e.resolveTaskFilePath(instanceKey, relativePath),
    resolveOutputPath: (instanceKey, relativePath, base) =>
      e.resolveOutputPath(instanceKey, relativePath, base ?? 'instance'),
    resolveReadableFilePath: (instanceKey, relativePath) =>
      e.resolveReadableFilePath(instanceKey, relativePath),
    runCodeRunner: (cfg, instanceKey, stageId) => e.runCodeRunner(cfg, instanceKey, stageId, targetPanel),
    trackPersistedFile: (input) => e.trackPersistedFile(input),
  };
}

export function buildDagBindings(
  engine: ExecutionLlmHost & ExecutionPathHost,
): Pick<ExecuteNextStageLoopParams, 'enableDagScheduler' | 'dagMaxParallelism'> {
  const e = engine;
  return {
    enableDagScheduler: resolveEffectiveEnableDagScheduler(e.instance!.definition.globalConfig),
    dagMaxParallelism: e.resolveDagMaxParallelismForInstance(),
  };
}
