import type { Artifact } from './ArtifactLifecycleManager';
import type { PlanSummary, StageSourceEdge } from './WorkflowPlanSummary';
import type { StageArtifactHint } from './ArtifactUiHints';

// ─── 工具类型 ───────────────────────────────────────────────────
export type ToolType = 'llm-text' | 'code-runner' | 'file-write' | 'file-read' | 'user-prompt';

// ─── ToolConfig（discriminated union） ─────────────────────────
/** `instance`：相对 `taskDir`；`workspace`：相对 `meta.taskWorkspacePath`（用户所选工作文件夹根，如已 npm init 的 `task/qr-app/`） */
export type ToolPathBase = 'instance' | 'workspace';

/** 未显式声明 pathBase / writePathBase 时的默认落盘根（文件树可见）；无 taskWorkspacePath 时引擎 resolveOutputPath 自动回退 instance。 */
export const DEFAULT_TOOL_PATH_BASE: ToolPathBase = 'workspace';

export interface LlmTextConfig {
  type: 'llm-text';
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
  /** 可选：将本阶段主输出写入指定相对路径文件（相对于 taskDir 或 workspace 根，取决于 writePathBase）；用于“实现 → 写文件 → 编译验证”链路。 */
  writeOutputToFile?: string;
  /** 写入根目录；默认 workspace（见 DEFAULT_TOOL_PATH_BASE）。无 taskWorkspacePath 时回退 instance。 */
  writePathBase?: ToolPathBase;
  /** fix 等多目标落盘：LLM 输出使用 --- file: <path> --- 分隔块。 */
  additionalWriteTargets?: string[];
  multiFileOutputFormat?: 'delimited';
}

export interface CodeRunnerConfig {
  type: 'code-runner';
  command: string;
  workingDir?: string;
  /** 命令 cwd 根目录；默认 workspace（见 DEFAULT_TOOL_PATH_BASE）。无 taskWorkspacePath 时回退 instance。 */
  pathBase?: ToolPathBase;
  timeout?: number; // 秒，默认 60
  captureOutput: boolean;
  /** B-Q1：长驻进程（smoke/e2e）有界运行 */
  serve?: boolean;
  readyProbe?: string;
  graceMs?: number;
  readyTimeoutMs?: number;
}

export interface FileWriteConfig {
  type: 'file-write';
  filePath: string;
  sourceOutputKey: string;
  /** 从指定阶段的运行时读取 sourceOutputKey；未设置时按 key 在 stages 中首次命中（向后兼容） */
  sourceStageId?: string;
  /** 落盘根目录；默认 instance。workspace 时写入用户工作文件夹根下相对路径 */
  pathBase?: ToolPathBase;
}

export interface FileReadConfig {
  type: 'file-read';
  filePath: string;
}

export interface UserPromptConfig {
  type: 'user-prompt';
  promptText: string;
  inputLabel: string;
}

export type ToolConfig =
  | LlmTextConfig
  | CodeRunnerConfig
  | FileWriteConfig
  | FileReadConfig
  | UserPromptConfig;

// ─── StageOutput ───────────────────────────────────────────────
export interface StageOutput {
  key: string;
  format: 'text' | 'markdown' | 'json' | 'file-path';
  description?: string;
}

// ─── SkipCondition ─────────────────────────────────────────────
export interface SkipCondition {
  type:
    | 'exitCodeZero'
    | 'exitCodeNonZero'
    | 'stageSkipped'
    | 'stageSkippedOrExitCodeZero'
    | 'anyTestRunFailed';
  /** anyTestRunFailed 时忽略；其余类型必填 */
  stageId: string;
  outputKey?: string; // 默认 '_exitCode'
}

// ─── ErrorHandling ─────────────────────────────────────────────
export interface ErrorHandling {
  strategy: 'retry' | 'fail' | 'pause' | 'skip';
  maxRetries?: number; // strategy='retry' 时有效，默认 3
  escalateAfterRetries?: boolean; // 默认 true（超限后切换为 'pause'）
}

// ─── StageInput ────────────────────────────────────────────────
export type InputContextMode = 'full' | 'summary' | 'reference';

export interface InputSource {
  type: 'stage-output' | 'user-input' | 'human-answer' | 'human-answer-before' | 'constant' | 'file';
  stageId?: string;
  outputKey?: string;
  questionId?: string;
  filePath?: string;
  value?: string;
  label?: string;
  /** type=file 时读取根目录；默认 instance（taskDir），workspace 对齐 meta.taskWorkspacePath */
  pathBase?: ToolPathBase;
  /** 显式上下文压缩（对齐 ai-workflow contextMode）；未设时由引擎按 token 自动降级 */
  contextMode?: InputContextMode;
  /** 默认 true；resolveInput 可扩展消费 */
  required?: boolean;
}

export interface StageInput {
  sources: InputSource[];
  mergeStrategy: 'concat' | 'template' | 'object';
  mergeTemplate?: string;
}

// ─── Question ──────────────────────────────────────────────────
export interface Question {
  id: string;
  text: string;
  hint?: string;
  required?: boolean; // 默认 true
  /** stageQuestionsBefore 出站 enrich；不属于持久化 workflow JSON */
  suggestedAnswer?: string;
  provenance?: import('./charter/CharterTypes').DecisionProvenance;
  ruleRefs?: number[];
}

// ─── Stage ─────────────────────────────────────────────────────
export interface Stage {
  id: string;
  title: string;
  description?: string;
  /** 确认页只读：本阶段审核重点 / 常见失败提示（生成器可选填写） */
  aiTip?: string;
  tool: ToolType;
  toolConfig: ToolConfig;
  input: StageInput;
  outputs: StageOutput[];
  pauseAfter: boolean;
  isDecisionStage?: boolean;
  exposeAssumptions?: boolean;
  /** 工具执行前追问；见 SPEC-v2 §4.1 / 任务清单 M7 */
  questionBefore?: Question[];
  questionAfter?: Question[];
  patchMode?: boolean;
  skipIf?: SkipCondition;
  onError?: ErrorHandling;
  /** 前置 stage id 列表；若声明则每一项必须存在于 workflow 且在本阶段之前（§7.8.3 / SPEC §4.1）。是否按 DAG 执行由 globalConfig.enableDagScheduler 决定。 */
  dependsOn?: string[];
  /** 引擎注入阶段元数据（如 deterministic conftest / self-heal）。 */
  meta?: { executionMode?: string; [key: string]: unknown };
}

// ─── WorkflowDefinition ────────────────────────────────────────
export interface WorkflowMeta {
  title: string;
  taskType: string; // software / video / document / debug / ...
  userInput: string;
  createdAt: string;
  /** true = 全新项目（绿场），豁免 Rule 20-G zoom-out；见 SPEC-v2 Rule 20-G / §11 */
  isGreenfield?: boolean;
  /**
   * 用户指定的任务工作区根目录（绝对路径）。生成工作流时由 UI 写入；`code-runner` / `writeOutputToFile` 等落盘相对于
   * `\<该路径>/.stagent/instances/<实例 id>/`。若未设置且未打开 VS Code 工作区，开始执行会失败。
   */
  taskWorkspacePath?: string;
  /** Path Router 选路结果（express / greenfield_full / debug / …） */
  workflowTemplate?: string;
  /** 工作计划骨架模板版本（expandGreenfieldPythonSkeleton 写入）。 */
  skeletonVersion?: string;
  /**
   * 带 writeOutputToFile 的实现阶段在写入已存在文件时的策略：
   * - 'regenerate'（默认）始终覆盖写入
   * - 'reuse-all' 已存在时跳过写入并复用磁盘内容
   * - 'reuse-partial' 预留给“部分复用+人工确认”场景（当前行为与 'regenerate' 一致）
   */
  reuseStrategy?: 'regenerate' | 'reuse-all' | 'reuse-partial';
  /**
   * 生成前澄清扫描到的工作文件夹已有文件（相对路径，最多约 20 个）。
   * 由 generateClarifyQuestions / generateWorkflow 写入，供审计与 reuse-* 策略参考。
   */
  existingFiles?: string[];
  /**
   * 需求润色溯源：用户先「需求润色」再「生成工作流」时由引擎写入；便于审计与复盘，不参与执行期工具路径解析。
   */
  userInputPolish?: {
    originalDraft: string;
    polishedAt: string;
  };
  /** Rule20 normalize：引擎自动插入的全局架构决策阶段 id。 */
  engineAutoInsertedGlobalArchitectureStageId?: string;
  /** R3b：requirements.txt 上次 pip 安装时的内容快照（pre-test_run pip-resync）。 */
  _lastRequirementsPipHash?: string;
}

/** 全局决策注入 systemPrompt 时：summary = 每条截断摘要；full = 全文 */
export type GlobalDecisionInjectMode = 'full' | 'summary';

export interface WorkflowGlobalConfig {
  autoAdvance?: boolean;
  /** M12：DAG 调度开关。未设置或 false 为线性执行；true 时按 dependsOn + stage-output 拓扑调度（并行度见 dagMaxParallelism）。 */
  enableDagScheduler?: boolean;
  /** M12.4：DAG 并行度。未设或 1 = 单线程（默认，兼容 M12）；≥2 时每波最多并行该数量的 ready 阶段（决策/pauseAfter/questionBefore 仍串行）。 */
  dagMaxParallelism?: number;
  /**
   * M13.1：决策清单内容级 HARD 校验灰度开关（v2.7 引入）。
   * - 未设或 false：approveDecision 不做内容级校验（仍由 §8.1 UI 质量核查兜底，与 v2.6 行为一致）。
   * - true：approveDecision 触发 DecisionRecordVerify，违反 I-17/I-18/I-19 则推 stageError(invariant-violation) 阻断批准。
   * 对应 SPEC §4.4「升 HARD 入口」与 §9.1 I-17 ~ I-19。
   */
  enableDecisionContentLint?: boolean;
  /**
   * 为 true 时，非决策 llm-text 阶段将已批准 decisionRecord **摘要/全文** 追加到 systemPrompt。
   * 未设时由 vscode `stagent.injectApprovedDecisionContext` 决定（默认 true）。
   */
  injectApprovedDecisionContext?: boolean;
  /** 全局决策注入模式；未设时用 vscode `stagent.globalDecisionInjectMode`（默认 summary） */
  globalDecisionInjectMode?: GlobalDecisionInjectMode;
  language?: string;
  /** Plan Compiler：node | python | auto（生成期 Path Router 建议）。 */
  stackProfile?: 'node' | 'python' | 'auto';
  modelOverrides?: {
    decisionStage?: string;
    implStage?: string;
    lightweightStage?: string;
  };
}

export interface WorkflowDefinition {
  id: string;
  version: '2.0';
  meta: WorkflowMeta;
  stages: Stage[];
  globalConfig?: WorkflowGlobalConfig;
}

// ─── StageRuntime ──────────────────────────────────────────────
export type StageStatus =
  | 'pending'
  | 'running'
  | 'waiting-questions'
  | 'paused'
  | 'done'
  | 'skipped'
  | 'error'
  | 'retrying';

/** 阶段失败时持久化的错误摘要，供 resume 重放 stageError / RetryBox。 */
export interface StageRuntimeLastError {
  error: string;
  errorType: ErrorType;
  stdout?: string;
  stderr?: string;
}

/** 智能重试：applyRetryBase 前捕获的失败快照。 */
export interface StageFailureSnapshot {
  capturedAt: string;
  error?: string;
  errorType?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  outputs: Record<string, unknown>;
}

export interface StageRuntime {
  stageId: string;
  status: StageStatus;
  outputs: Record<string, unknown>;
  retryCount: number;
  retryComment?: string;
  questionBeforeAnswers?: Record<string, string>;
  questionAnswers?: Record<string, string>;
  approvedDecisionRecord?: string;
  /** B-R2：决策答案来源（human / charter_direct / charter_inferred / escalated）。 */
  decisionProvenance?: import('./charter/CharterTypes').DecisionProvenance;
  /** B-R2：决策批准来源；frontload 表示确认页前置批准。 */
  decisionSource?: 'inline' | 'frontload';
  /** B-R2：questionBefore 各题答案来源。 */
  charterQuestionProvenance?: Record<string, import('./charter/CharterTypes').DecisionProvenance>;
  /** M23：自适应 grill 当前轮次。 */
  grillRound?: number;
  startedAt?: string;
  completedAt?: string;
  /** 最近一次 stageError 摘要（重启恢复时可重放）。 */
  lastError?: StageRuntimeLastError;
  lastFailureSnapshot?: StageFailureSnapshot;
  redGreenSlice?: { semantic: string; phase: 'red-confirmed' | 'blocked-green' };
}

// ─── WorkflowInstance ──────────────────────────────────────────
export type WorkflowStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

export interface WorkflowInstance {
  traceId?: string;
  definition: WorkflowDefinition;
  currentStageIndex: number;
  stageRuntimes: StageRuntime[];
  status: WorkflowStatus;
  taskDir?: string;
  startedAt?: string;
  completedAt?: string;
  /** M15.4：file-write / writeOutputToFile 落盘追踪，用于决策重试磁盘回滚 */
  artifactRegistry?: Artifact[];
  /** 持久化世代号（磁盘与 globalState 对账）。 */
  persistRevision?: number;
  /** 最近一次落盘时间（ISO）。 */
  lastSavedAt?: string;
}

// ─── PatchInstruction ──────────────────────────────────────────
export interface PatchInstruction {
  search: string;
  replace: string;
  filePath: string;
}

// ─── ErrorType ─────────────────────────────────────────────────
// 与 SPEC-v2 §4.9 一致（含 v2 新增的 code-runner-timeout）
export type ErrorType =
  | 'llm-timeout'
  | 'llm-context-overflow'
  | 'llm-invalid-output'
  | 'llm-refusal'
  | 'llm-quality-below-threshold'
  | 'tool-execution-failed'
  | 'code-runner-timeout'
  | 'file-not-found'
  | 'stage-not-found'
  | 'invariant-violation'
  | 'retry-limit-exceeded'
  | 'sandbox-network-blocked'
  | 'sandbox-memory-exceeded'
  | 'static-analysis-failed'
  | 'confidence-too-low'
  | 'unknown';

// ─── 引擎活动 / 质量报告（屏 4–5，对齐 stagent_vscode workflow-types） ───
export type EngineActivityKind =
  | 'gate'
  | 'replan'
  | 'preflight'
  | 'milestone'
  | 'info'
  | 'verify'
  | 'fix'
  | 'engine';

import type {
  QualityReportPayload as EngineQualityReportPayload,
  QualityReportVerificationRow as EngineQualityReportVerificationRow,
} from './quality-report/QualityReportTypes';

export type QualityReportPayload = EngineQualityReportPayload;
export type QualityReportVerificationRow = EngineQualityReportVerificationRow;

// ─── 消息协议（后端 → 前端） ────────────────────────────────────
type BackendMessageInner =
  | {
      type: 'workflowGenerated';
      workflow: WorkflowDefinition;
      warnings?: string[];
      warningsDisplay?: string[];
      planSummary?: PlanSummary;
      stageSourceSummary?: StageSourceEdge[];
      /** A 方案：硬门禁拦截但结构可渲染时为 true，确认页只读展示并禁用开始执行 */
      blocked?: boolean;
      /** blocked=true 时的拦截原因（每条一行展示在确认页顶部红色横幅） */
      blockReasons?: string[];
      /** 确认页已持久化的 idle 草稿实例 key；「开始执行」回传以复用、放弃时据此删除 */
      instanceKey?: string;
      /** Path Router + taskType 判别摘要（确认页决策板） */
      taskTypeClassification?: import('./TaskTypeResolution').TaskTypeClassificationInfo;
      /** B-R2：确认页决策板（Charter 代答分类） */
      decisionBoard?: import('./decision-frontload/DecisionFrontloadTypes').DecisionBoardPayload;
    }
  | {
      type: 'stageStatusUpdate';
      stageId: string;
      status: StageStatus;
      isDecisionStage?: boolean;
      retryDisabled?: boolean;
      execSemantic?: 'deferred' | 'self-healing' | null;
    }
  | { type: 'stageOutputUpdate'; stageId: string; outputKey: string; content: unknown }
  | { type: 'stageQuestionsBefore'; stageId: string; questions: Question[] }
  | { type: 'stageQuestions'; stageId: string; questions: Question[] }
  | {
      type: 'stageError';
      stageId: string;
      error: string;
      errorType: ErrorType;
      traceId?: string;
      rawOutput?: string;
      stdout?: string;
      stderr?: string;
      userTitle?: string;
      userBody?: string;
      userCategory?: 'environment' | 'code' | 'generic';
      exitCode?: number;
      weakenRetry?: boolean;
      playbookSteps?: string[];
      diagnosticRoute?: import('./workflow-types/MessageTypes').DiagnosticRoute;
    }
  | {
      type: 'workflowEscalation';
      stageId: string;
      issues: string[];
      choices?: Array<'confirm' | 'reopen_decision' | 'abort'>;
      reopenDecisionStageId?: string;
    }
  | {
      type: 'dagWaveUpdate';
      waveIndex: number;
      activeStageIds: string[];
      phase: 'start' | 'complete';
    }
  | {
      type: 'workflowCompleted';
      warnings?: string[];
      qualityReport?: QualityReportPayload;
      traceId?: string;
    }
  | {
      type: 'engineActivity';
      kind: EngineActivityKind;
      text: string;
      stageId?: string;
      timestamp?: string;
    }
  | { type: 'workflowFailed'; reason: string; errorType: ErrorType; stageId?: string; traceId?: string }
  | {
      type: 'downstreamReset';
      decisionStageId: string;
      resetStageIds: string[];
      resetStageTitles: string[];
      rolledBackFiles?: string[];
      rollbackFailed?: Array<{ filePath: string; error: string }>;
    }
  | { type: 'stageArtifactHints'; stageId: string; artifacts: StageArtifactHint[] }
  | {
      type: 'stageConfidenceUpdate';
      stageId: string;
      score: number;
      level: 'high' | 'medium' | 'low' | 'critical';
      reasons: string[];
    }
  | { type: 'streamChunk'; stageId: string; chunk: string }
  | { type: 'actionHint'; message: string; stageId?: string }
  | {
      type: 'upstreamFixStarted';
      failedStageId: string;
      targetImplStageId: string;
      resetStageIds: string[];
      resetStageTitles: string[];
    }
  | { type: 'loadTaskList'; instances: WorkflowInstance[] }
  | {
      type: 'clarifyQuestions';
      questions: Array<{ id: string; text: string; options?: string[] }>;
    }
  | { type: 'taskWorkspacePathPicked'; path: string }
  | { type: 'polishSessionHint'; message: string }
  | {
      type: 'userTaskPolished';
      text: string;
      polishedAt: string;
      fromCache?: boolean;
      instanceKey?: string;
      polishTierUsed?: 'light' | 'standard' | 'auto';
    }
  | {
      type: 'generationProgress';
      operation: 'workflow' | 'polish' | 'clarify' | 'dag';
      phase: 'preparing' | 'llm' | 'parsing' | 'validating' | 'start' | 'complete';
      message: string;
      detail?: string;
    }
  | { type: 'generationCancelled'; reason?: string }
  | {
      type: 'instanceResumed';
      resync?: boolean;
      instanceKey: string;
      workflow: WorkflowDefinition;
      instanceStatus: WorkflowStatus;
      stageStatuses?: Record<string, StageStatus>;
      failedStageId?: string;
      failedSummary?: { error: string; errorType: ErrorType };
    }
  | {
      type: 'instanceSwitchBlocked';
      reason: string;
      targetInstanceKey: string;
      activeInstanceKey?: string;
    }
  | { type: 'sessionSynced'; sessionId: string; instanceKey: string }
  | { type: 'instanceKeySynced'; instanceKey: string; sessionId?: string };

/** 出站序号 / 实例指针（Messaging 层注入）。 */
export type BackendMessage = BackendMessageInner & {
  seq?: number;
  uiEpoch?: number;
  sessionId?: string;
  instanceKey?: string;
};

// ─── 消息协议（前端 → 后端） ────────────────────────────────────
export type FrontendMessage =
  | { type: 'webviewReady' }
  | {
      type: 'generateWorkflow';
      userInput: string;
      taskType?: string;
      clarifyAnswers?: Record<string, string>;
      /** 必填：任务输出根目录（绝对路径或 ~/ 开头），由输入页收集 */
      taskWorkspacePath: string;
      /** 若本生成紧接在「需求润色」之后，写入 meta.userInputPolish 溯源 */
      polishContext?: { originalDraft: string; polishedAt: string };
    }
  | { type: 'pickTaskWorkspaceFolder' }
  /** 生成前澄清：扫描工作文件夹已有文件并请模型给出 3-5 个澄清问题；回应 clarifyQuestions */
  | { type: 'clarifyStart'; userInput: string; taskType?: string; taskWorkspacePath: string }
  /** 将草稿润色为规范「用户任务」短文；成功时推送 userTaskPolished */
  | { type: 'polishUserTask'; draft: string; taskType?: string; taskWorkspacePath?: string }
  | { type: 'startExecution'; workflow?: WorkflowDefinition; instanceKey?: string }
  | { type: 'approve'; stageId: string }
  | { type: 'approveDecision'; stageId: string; decisionRecord: string }
  | { type: 'answerQuestionsBefore'; stageId: string; answers: Record<string, string> }
  | { type: 'answerQuestions'; stageId: string; answers: Record<string, string> }
  | { type: 'retry'; stageId: string; comment: string }
  | { type: 'copyDebugLog' }
  | { type: 'copySessionLog' }
  | { type: 'editOutput'; stageId: string; outputKey: string; newContent: unknown }
  | { type: 'openArtifactDiff'; stageId: string; filePath: string }
  | { type: 'openArtifactFile'; stageId: string; filePath: string };
