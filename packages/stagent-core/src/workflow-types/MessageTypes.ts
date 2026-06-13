import type { PlanSummary, StageSourceEdge } from '../WorkflowPlanSummary';
import type { StageArtifactHint } from '../ArtifactUiHints';
import type { Question } from './StageTypes';
import type { WorkflowDefinition, WorkflowGlobalConfig, WorkflowMeta } from './WorkflowMetaTypes';
import type { ErrorType, StageStatus, WorkflowStatus } from './RuntimeTypes';
import type { GenerationOperationId } from '../generation/GenerationOperationIds';
import type { HITLDecisionMode } from '../AdaptiveHITLPolicy';
import type { TaskTypeClassificationInfo } from '../TaskTypeResolution';

/** Stub until decision-frontload is fully wired in Electron host. */
export interface DecisionBoardPayload {
  items: Array<Record<string, unknown>>;
  summary: { total: number; auto: number; needsReview: number };
}

export interface FrontloadDecisionResolution {
  stageId: string;
  decisionRecord: string;
  provenance?: Record<string, unknown>;
}

/** Stub until quality-report module is fully wired in Electron host. */
export interface QualityReportPayload {
  afk?: unknown;
  verificationRows?: unknown[];
  engineSummary?: string;
  diagnosticRoutes?: DiagnosticRoute[];
}

/** Stub until diagnostic-router module is fully wired in Electron host. */
export interface DiagnosticRoute {
  category?: string;
  action?: string;
  rationale?: string;
}

/** 屏 4 Engine Feed 事件种类（与 P0–P3d 对齐）。 */
export type EngineActivityKind = 'gate' | 'replan' | 'preflight' | 'verify' | 'fix' | 'engine';

/** test_run 软失败等执行语义（区别于 StageStatus）。 */
export type StageExecSemantic = 'deferred' | 'self-healing';

/** M40.0：生成期结构修补摘要（确认页展示，非运行期保证） */
export interface StructuralRepairActionSummary {
  source: 'plan-completeness';
  code: string;
  action: 'insert-stage';
  stageIds: string[];
  pathConfidence: 'high' | 'deferred';
  message: string;
}

/** 可选单调序号：WorkflowUiBridge postMessage 注入；webview 用于丢弃乱序 stageStatusUpdate。 */
export type BackendMessageSeqFields = { seq?: number };

/** 可选 resync 代数：beginUiResync 递增；webview 丢弃 stale epoch 之前的 live 消息。 */
export type BackendMessageUiEpochFields = { uiEpoch?: number };

/** 可选实例绑定：Bridge 对执行期消息注入；与 sessionId 同值。 */
export type BackendMessageInstanceFields = { instanceKey?: string; sessionId?: string };

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
      /** M40.0：引擎自动插入的阶段摘要（成功或仍被阻断时均可附带） */
      structuralRepairs?: StructuralRepairActionSummary[];
      /** 确认页已持久化的 idle 草稿 session；「开始执行」回传以复用、放弃时据此删除 */
      instanceKey?: string;
      /** M44：与 instanceKey 同值；webview 只缓存 sessionId */
      sessionId?: string;
      /** P2-3：生成时参考的历史经验条数（不含 userInput 原文）。 */
      experienceReferencesUsed?: number;
      /** P1-2：当前 VS Code settingsProfile（确认页摘要）。 */
      settingsProfile?: string;
      /** 相对 default 的门禁差异摘要（确认页）。 */
      profileGateDiff?: string[];
      /** B-R2：确认页决策板（全部 isDecisionStage + Charter 代答分类）。 */
      decisionBoard?: DecisionBoardPayload;
      /** B-R2：当前 HITL 决策模式（确认页闸门/UI 行为）。 */
      decisionMode?: HITLDecisionMode;
      /** B-R1：场景判别摘要（taskType / isGreenfield 依据，确认页可改）。 */
      taskTypeClassification?: TaskTypeClassificationInfo;
    }
  | {
      type: 'stageStatusUpdate';
      stageId: string;
      status: StageStatus;
      isDecisionStage?: boolean;
      /** True when the stage has reached the manual retry limit (pause-bar retry should be disabled). */
      retryDisabled?: boolean;
      /** 屏 4：test_run 软失败等语义状态（黄 deferred / 修复中）。 */
      execSemantic?: StageExecSemantic | null;
    }
  | {
      type: 'engineActivity';
      kind: EngineActivityKind;
      text: string;
      stageId?: string;
      timestamp?: string;
    }
  | { type: 'stageOutputUpdate'; stageId: string; outputKey: string; content: unknown }
  | { type: 'stageQuestionsBefore'; stageId: string; questions: Question[] }
  | { type: 'stageQuestions'; stageId: string; questions: Question[] }
  | {
      type: 'stageError';
      stageId: string;
      error: string;
      errorType: ErrorType;
      /** 运行关联 id（与 .wf-debug.log / session log 一致）。 */
      traceId?: string;
      rawOutput?: string;
      stdout?: string;
      stderr?: string;
      /** P1-4：StageErrorCatalog 用户可读标题（原始 error 仍保留供调试）。 */
      userTitle?: string;
      /** 面向用户的主说明（非技术原文）。 */
      userBody?: string;
      userCategory?: 'environment' | 'code' | 'generic';
      exitCode?: number;
      /** 127 等场景：重试通常无效，UI 应弱化重试按钮。 */
      weakenRetry?: boolean;
      playbookSteps?: string[];
      /** Contract-First P5：失败诊断路由（config/symbol/assertion/semantic）。 */
      diagnosticRoute?: DiagnosticRoute;
    }
  | {
      type: 'workflowEscalation';
      stageId: string;
      issues: string[];
      choices: Array<'confirm' | 'reopen_decision' | 'abort'>;
      reopenDecisionStageId?: string;
    }
  | { type: 'workflowCompleted'; warnings?: string[]; traceId?: string; qualityReport?: QualityReportPayload }
  | {
      type: 'workflowFailed';
      reason: string;
      errorType: ErrorType;
      stageId?: string;
      traceId?: string;
    }
  | {
      type: 'downstreamReset';
      decisionStageId: string;
      resetStageIds: string[];
      resetStageTitles: string[];
      rolledBackFiles?: string[];
      rollbackFailed?: Array<{ filePath: string; error: string }>;
    }
  | {
      type: 'upstreamFixStarted';
      failedStageId: string;
      targetImplStageId: string;
      resetStageIds: string[];
      resetStageTitles: string[];
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
  /** startExecution 后同步真实 sessionId（reuse=false 时会换新 UUID，避免 webview 仍带确认页旧 id） */
  | { type: 'instanceKeySynced'; instanceKey: string; sessionId?: string }
  | { type: 'sessionSynced'; sessionId: string; instanceKey: string }
  | {
      type: 'clarifyQuestions';
      questions: Array<{ id: string; text: string; options?: string[] }>;
    }
  | { type: 'taskWorkspacePathPicked'; path: string }
  | {
      type: 'userTaskPolished';
      text: string;
      polishedAt: string;
      fromCache?: boolean;
      /** 实际使用的润色档位（auto 已解析为 light | standard） */
      polishTierUsed?: 'light' | 'standard';
      instanceKey?: string;
      sessionId?: string;
    }
  | {
      type: 'generationProgress';
      operation: GenerationOperationId;
      phase: 'preparing' | 'llm' | 'parsing' | 'validating';
      message: string;
      detail?: string;
    }
  /** 生成被用户取消（非错误）：仅清除输入页 busy，不显示错误横幅 */
  | { type: 'generationCancelled'; reason?: string }
  | {
      type: 'instanceResumed';
      /** 由 recovery/resync burst 发出；调试/日志用。 */
      resync?: boolean;
      instanceKey: string;
      sessionId?: string;
      workflow: WorkflowDefinition;
      instanceStatus: WorkflowStatus;
      /** 恢复执行页时预填时间线状态，避免 reset 与 replay 之间的全 pending 闪烁 */
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
  | {
      type: 'dagWaveUpdate';
      waveIndex: number;
      activeStageIds: string[];
      phase: 'start' | 'complete';
    }
  | {
      type: 'llmUsageUpdate';
      stageId: string;
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
      operation?: string;
    };

export type BackendMessage = BackendMessageInner &
  BackendMessageSeqFields &
  BackendMessageUiEpochFields &
  BackendMessageInstanceFields;

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
  | {
      type: 'polishUserTask';
      draft: string;
      taskType?: string;
      taskWorkspacePath?: string;
      /** 润色档位：auto 根据草稿推断，light 适合简单任务，standard 适合复杂交付 */
      polishTier?: 'auto' | 'light' | 'standard';
    }
  | {
      type: 'startExecution';
      workflow?: WorkflowDefinition;
      sessionId?: string;
      instanceKey?: string;
      /** B-R2 frontloaded：确认页批准的决策（auto 项默认采纳 + 用户处理的升级项）。 */
      frontloadResolutions?: FrontloadDecisionResolution[];
    }
  | { type: 'approve'; stageId: string }
  | { type: 'approveDecision'; stageId: string; decisionRecord: string; sessionId?: string; instanceKey?: string }
  | { type: 'answerQuestionsBefore'; stageId: string; answers: Record<string, string> }
  | { type: 'answerQuestions'; stageId: string; answers: Record<string, string> }
  | { type: 'retry'; stageId: string; comment: string }
  | { type: 'upstreamFix'; failedStageId: string }
  | { type: 'copyDebugLog' }
  | { type: 'copySessionLog' }
  | { type: 'editOutput'; stageId: string; outputKey: string; newContent: unknown }
  | { type: 'openArtifactDiff'; stageId: string; filePath: string }
  | { type: 'openArtifactFile'; stageId: string; filePath: string };

// Re-export meta types referenced by messages for convenience
export type { WorkflowDefinition, WorkflowGlobalConfig, WorkflowMeta };
