import type { ConfigPort } from '../platform/PlatformAdapter';
import type { ExecuteNextStageLoopParams } from '../WorkflowExecutorTypes';
import { evaluateSkipCondition } from '../WorkflowSkipCondition';
import type { SkipCondition, Stage, StageRuntime, ToolPathBase } from '../WorkflowDefinition';
import { DEFAULT_TOOL_PATH_BASE } from '../WorkflowDefinition';
import type { WorkflowInstance } from '../WorkflowDefinition';
import type { WorkflowParallelMonitor } from '../WorkflowParallelMonitor';
import { buildHITLPolicy } from '../AdaptiveHITLPolicy';
import {
  readConfidencePauseThreshold,
  readContractNodePauseThreshold,
  readPauseContractNodesEnabled,
  readStaticAnalysisEnabled,
} from '../StagentSettings';
import { getStagentConfiguration } from '../settings/getStagentConfiguration';
import { readCharterAutoAnswerMode } from '../settings/readers/charter';
import { readHitlDecisionMode } from '../settings/readers/hitl';
import {
  analysisResultsToWarningLines,
  buildDefaultWorkspaceChecks,
  runStaticAnalysis,
} from '../StaticAnalysisPipeline';

/** 从 WorkflowEngineCore 抽出的执行循环入参组装所需窄接口。 */
export interface ExecutionLoopParamsHost {
  readonly instance: WorkflowInstance;
  readonly currentInstanceKey: string | undefined;
  setCurrentInstanceKey(instanceKey: string | undefined): void;
  postMessage(msg: import('../WorkflowDefinition').BackendMessage): void;
  scheduleSave(): void;
  warn(message: string): void;
  debugLog(stageId: string, event: string, attempt: number, payload?: unknown): void;
  isDebugVerbose(): boolean;
  primaryOutputKey(stage: Stage): string;
  ensureTaskDir(instanceKey: string): void;
  resolveInput(stage: Stage, runtime: StageRuntime, panel: unknown): Promise<string>;
  augmentSystemPromptWithGlobalDecisions(stage: Stage, runtime: StageRuntime, sys: string): string;
  executeLlmText(stageId: string, systemPrompt: string, userContent: string): Promise<string>;
  applyPatchInstructions(
    instanceKey: string,
    instructions: import('../WorkflowDefinition').PatchInstruction[],
    runtime: StageRuntime,
    outKey: string,
    pathBase?: ToolPathBase,
  ): Promise<void>;
  resolveTaskFilePath(instanceKey: string, relativePath: string): string;
  resolveOutputPath(instanceKey: string, relativePath: string, base?: ToolPathBase): string;
  resolveReadableFilePath(instanceKey: string, relativePath: string): string;
  runCodeRunner(
    cfg: import('../WorkflowDefinition').CodeRunnerConfig,
    instanceKey: string,
    stageId: string,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  resolveDagMaxParallelismForInstance(): number;
  logUserAction(kind: string, detail: Record<string, unknown>): void;
  trackPersistedFile(input: {
    stageId: string;
    outputKey: string;
    filePath: string;
    content: string;
    existedBefore: boolean;
    priorContent?: string;
  }): void;
  getWorkspaceRootAbsolute(): string | undefined;
  runWorkspaceContractLint(): Promise<string[]>;
  readonly platformConfig: ConfigPort;
}

export function buildExecutionLoopParams(
  host: ExecutionLoopParamsHost,
  parallelMonitor: WorkflowParallelMonitor,
): ExecuteNextStageLoopParams {
  return {
    instance: host.instance,
    panel: undefined,
    currentInstanceKey: host.currentInstanceKey,
    setCurrentInstanceKey: (instanceKey) => host.setCurrentInstanceKey(instanceKey),
    evaluateSkipCondition,
    postMessage: (_p, msg) => host.postMessage(msg),
    scheduleSave: () => host.scheduleSave(),
    warn: (message) => host.warn(message),
    debugLog: (stageId, event, attempt, payload) => host.debugLog(stageId, event, attempt, payload),
    debugLogLlmPreview: (stageId, attempt, preview) => {
      if (host.isDebugVerbose()) {
        host.debugLog(stageId, 'llm_output_preview', attempt, preview);
      }
    },
    primaryOutputKey: (stage) => host.primaryOutputKey(stage),
    ensureTaskDir: (instanceKey) => host.ensureTaskDir(instanceKey),
    resolveInput: (stage, runtime, _p) => host.resolveInput(stage, runtime, _p),
    executeLlmText: (stageId, sys, user, _p) => {
      const stage = host.instance.definition.stages.find((s) => s.id === stageId);
      const runtime = host.instance.stageRuntimes.find((r) => r.stageId === stageId);
      const augmented =
        stage && runtime ? host.augmentSystemPromptWithGlobalDecisions(stage, runtime, sys) : sys;
      return host.executeLlmText(stageId, augmented, user);
    },
    applyPatchInstructions: (instanceKey, instructions, runtime, outKey) =>
      host.applyPatchInstructions(instanceKey, instructions, runtime, outKey),
    resolveTaskFilePath: (instanceKey, relativePath) =>
      host.resolveTaskFilePath(instanceKey, relativePath),
    resolveOutputPath: (instanceKey, relativePath, base) =>
      host.resolveOutputPath(instanceKey, relativePath, base ?? DEFAULT_TOOL_PATH_BASE),
    resolveReadableFilePath: (instanceKey, relativePath) =>
      host.resolveReadableFilePath(instanceKey, relativePath),
    runCodeRunner: (cfg, instanceKey, stageId) => host.runCodeRunner(cfg, instanceKey, stageId),
    isCancellationError: (error) =>
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'Canceled' || error.name === 'CancellationError'),
    enableDagScheduler: host.instance.definition.globalConfig?.enableDagScheduler === true,
    dagMaxParallelism: host.resolveDagMaxParallelismForInstance(),
    logUserAction: (kind, detail) => host.logUserAction(kind, detail),
    trackPersistedFile: (input) => host.trackPersistedFile(input),
    confidencePauseThreshold: readConfidencePauseThreshold(host.platformConfig),
    hitlPolicy: buildHITLPolicy({
      confidencePauseThreshold: readConfidencePauseThreshold(host.platformConfig),
      contractNodePauseThreshold: readContractNodePauseThreshold(host.platformConfig),
      pauseContractNodesBelowThreshold: readPauseContractNodesEnabled(host.platformConfig),
      charterAutoAnswerMode: readCharterAutoAnswerMode(getStagentConfiguration()),
      decisionMode: readHitlDecisionMode(getStagentConfiguration()),
    }),
    onDagParallelWaveStart: (stageIds) => parallelMonitor.recordWaveStart(stageIds),
    onDagParallelWaveComplete: (waveIndex) => {
      parallelMonitor.recordWaveComplete(waveIndex);
      return parallelMonitor.buildWaveDebugPayload(waveIndex);
    },
    postImplStaticAnalysis: readStaticAnalysisEnabled(host.platformConfig)
      ? async (_stage) => {
          const ws = host.getWorkspaceRootAbsolute();
          if (!ws) {
            return [];
          }
          const checks = buildDefaultWorkspaceChecks(ws);
          if (checks.length === 0) {
            return [];
          }
          const results = await runStaticAnalysis(checks, ws);
          return analysisResultsToWarningLines(results);
        }
      : undefined,
    preRunEndContractLint: async () => host.runWorkspaceContractLint(),
  };
}
