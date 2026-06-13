import type * as vscode from '../platform/HostTypes';

/** 阶段执行与 HITL 编排入口。 */
export interface ExecutionHostDeps {
  getExecutionDepth: () => number;
  executeNextStage: (panel?: vscode.WebviewPanel) => Promise<void>;
  rejectApproveDecision: (panel: vscode.WebviewPanel, stageId: string, reason: string) => void;
  markStageArtifactsApproved: (stageId: string) => void;
}
