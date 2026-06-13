import type { QualityGateExecutionHost } from '../quality-gate/QualityGateExecutionHost';
import type {
  BackendMessage,
  CodeRunnerConfig,
  PatchInstruction,
  SkipCondition,
  Stage,
  StageRuntime,
  ToolPathBase,
  WorkflowInstance,
} from '../WorkflowDefinition';
import type { CharterGrillAnswerAttempt } from '../charter/CharterGrillAutoAnswer';
import type { HITLPolicy } from '../AdaptiveHITLPolicy';

export type StageStepOutcome = 'continue' | 'halt' | 'failed' | 'replan';
export type CodeRunnerResult = { exitCode: number; stdout: string; stderr: string };
export type PanelLike = unknown;

export interface ExecutionInstanceSlice {
  instance: WorkflowInstance;
  panel: PanelLike;
  currentInstanceKey: string | undefined;
  setCurrentInstanceKey: (instanceKey: string) => void;
}

export interface ExecutionMessagingSlice {
  postMessage: (panel: PanelLike, msg: BackendMessage) => void;
  scheduleSave: () => void;
  persistMilestone?: () => void;
  warn: (message: string) => void;
  debugLog: (stageId: string, event: string, attempt: number, payload?: unknown) => void;
  debugLogLlmPreview?: (
    stageId: string,
    attempt: number,
    preview: { chars: number; head: string; tail: string },
  ) => void;
  logUserAction?: (kind: string, detail: Record<string, unknown>) => void;
}

export interface ExecutionLlmSlice {
  primaryOutputKey: (stage: Stage) => string;
  resolveInput: (stage: Stage, runtime: StageRuntime, panel: PanelLike) => Promise<string>;
  executeLlmText: (stageId: string, systemPrompt: string, userContent: string, panel: PanelLike) => Promise<string>;
  applyPatchInstructions: (
    instanceKey: string,
    instructions: PatchInstruction[],
    runtime: StageRuntime,
    outKey: string,
  ) => Promise<void>;
}

export interface ExecutionPathSlice {
  ensureTaskDir: (instanceKey: string) => void;
  resolveTaskFilePath: (instanceKey: string, relativePath: string) => string;
  resolveOutputPath: (instanceKey: string, relativePath: string, base?: ToolPathBase) => string;
  resolveReadableFilePath?: (instanceKey: string, relativePath: string) => string;
  runCodeRunner: (
    cfg: CodeRunnerConfig,
    instanceKey: string,
    stageId: string,
    opts?: { deterministic?: boolean },
  ) => Promise<CodeRunnerResult>;
  trackPersistedFile?: (input: {
    stageId: string;
    outputKey: string;
    filePath: string;
    content: string;
    existedBefore: boolean;
    priorContent?: string;
  }) => void;
}

export interface ExecutionControlSlice {
  evaluateSkipCondition: (condition: SkipCondition, runtimes: StageRuntime[]) => boolean;
  isCancellationError: (error: unknown) => boolean;
  enableDagScheduler?: boolean;
  dagMaxParallelism?: number;
  onDagParallelWaveStart?: (stageIds: string[]) => number;
  onDagParallelWaveComplete?: (waveIndex: number) => Record<string, unknown>;
}

export interface ExecutionQualitySlice {
  confidencePauseThreshold?: number;
  hitlPolicy?: HITLPolicy;
  postImplStaticAnalysis?: (stage: Stage) => Promise<string[]>;
  preRunEndContractLint?: () => Promise<string[]>;
  architectureDepthScoringEnabled?: boolean;
  testRunFailurePlaybookEnabled?: boolean;
  isAdaptiveGrillForStage?: (stage: Stage) => boolean;
  tryGrillCodeExplore?: (question: {
    id: string;
    text: string;
    hint?: string;
  }) => Promise<string | undefined>;
  /** B-R2：grill 前依 Charter 代答单题（同步；未命中返回 filled:false）。 */
  tryCharterGrillAutoAnswer?: (question: {
    id: string;
    text: string;
    hint?: string;
  }) => CharterGrillAnswerAttempt | null;
  qualityGateExecutionHost?: QualityGateExecutionHost;
  getWorkspaceRoot?: () => string | undefined;
  memoryExperienceEnabled?: boolean;
  warnOnExperienceReadFailure?: (message: string) => void;
}

export interface NonLlmToolExecutionParams {
  stage: Stage;
  runtime: StageRuntime;
  outKey: string;
  instance: WorkflowInstance;
  instanceKey: string;
  resolveTaskFilePath: (instanceKey: string, relativePath: string) => string;
  resolveOutputPath: (instanceKey: string, relativePath: string, base?: ToolPathBase) => string;
  resolveReadableFilePath?: (instanceKey: string, relativePath: string) => string;
  runCodeRunner: (
    cfg: CodeRunnerConfig,
    instanceKey: string,
    stageId: string,
    opts?: { deterministic?: boolean },
  ) => Promise<CodeRunnerResult>;
  stageIndex: number;
  trackPersistedFile?: ExecutionPathSlice['trackPersistedFile'];
  warn?: (message: string) => void;
}

export type ExecuteNextStageLoopParams = ExecutionInstanceSlice &
  ExecutionMessagingSlice &
  ExecutionLlmSlice &
  ExecutionPathSlice &
  ExecutionControlSlice &
  ExecutionQualitySlice;
