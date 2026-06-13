import type * as vscode from './platform/HostTypes';
import type { BackendMessage } from './WorkflowDefinition';
import { readEngineDebugVerbose } from './WorkflowEngineSettingsReaders';

export interface StageMessagingDelegateDeps {
  postMessage: (panel: vscode.WebviewPanel | undefined, msg: BackendMessage) => void;
  scheduleSave: () => void;
  persistMilestone: () => void;
  debugLog: (stageId: string, event: string, attempt: number, payload?: unknown) => void;
  warn: (message: string) => void;
  logUserAction: (kind: string, detail: Record<string, unknown>) => void;
}

/** 阶段执行：消息、持久化防抖与诊断日志。 */
export class StageMessagingDelegate {
  constructor(private readonly deps: StageMessagingDelegateDeps) {}

  postMessage(panel: vscode.WebviewPanel | undefined, msg: BackendMessage): void {
    this.deps.postMessage(panel, msg);
  }

  scheduleSave(): void {
    this.deps.scheduleSave();
  }

  persistMilestone(): void {
    this.deps.persistMilestone();
  }

  debugLog(stageId: string, event: string, attempt: number, payload?: unknown): void {
    this.deps.debugLog(stageId, event, attempt, payload);
  }

  warn(message: string): void {
    this.deps.warn(message);
  }

  isDebugVerbose(): boolean {
    return readEngineDebugVerbose();
  }

  logUserAction(kind: string, detail: Record<string, unknown>): void {
    this.deps.logUserAction(kind, detail);
  }
}
