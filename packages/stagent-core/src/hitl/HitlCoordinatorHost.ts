import type * as vscode from '../platform/HostTypes';
import type { BackendMessage, WorkflowInstance } from '../WorkflowDefinition';

/**
 * 2.3 接口隔离：原 19 方法的 `HitlCoordinatorHost` 按角色拆为四个交集成员，
 * 让消费点可只依赖所需角色（如纯诊断的 helper 只取 {@link HitlDiagnosticsHost}）。
 * `HitlCoordinatorHost` 保持为四者交集，实现类与既有消费点零改动。
 */

/** 实例状态读写与绑定、HITL 相关策略读取。 */
export interface HitlStateHost {
  getInstance(): WorkflowInstance | undefined;
  ensureInstanceBound(instanceKey: string | undefined, panel: vscode.WebviewPanel): boolean;
  bumpCurrentStageIndex(): void;
  setCurrentStageIndex(index: number): void;
  setInstanceStatus(status: WorkflowInstance['status']): void;
  getWorkspaceRootAbsolute(): string | undefined;
  getMaxManualStageRetries(): number;
  isDecisionContentLintVscodeDefault(): boolean;
  isContractCommitmentsEnabled(): boolean;
}

/** Webview 交互与推进执行。 */
export interface HitlUiHost {
  bindPanel(panel: vscode.WebviewPanel): void;
  postMessage(panel: vscode.WebviewPanel, msg: BackendMessage): void;
  executeNextStage(panel: vscode.WebviewPanel): Promise<void>;
  rejectApproveDecision(panel: vscode.WebviewPanel, stageId: string, reason: string): void;
}

/** 落盘与里程碑、产物审批标记。 */
export interface HitlPersistenceHost {
  markStageArtifactsApproved(stageId: string): void;
  scheduleSave(): void;
  persistMilestone(): void;
}

/** 日志与用户行为埋点。 */
export interface HitlDiagnosticsHost {
  logUserAction(kind: string, detail: Record<string, unknown>): void;
  debugLog(stageId: string, event: string, attempt: number, payload?: unknown): void;
  warn(message: string): void;
  error(message: string): void;
}

export type HitlCoordinatorHost = HitlStateHost &
  HitlUiHost &
  HitlPersistenceHost &
  HitlDiagnosticsHost;
