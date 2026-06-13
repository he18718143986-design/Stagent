import type * as vscode from '../platform/HostTypes';
import type { BackendMessage } from '../WorkflowDefinition';
import type { GenerationOperationId } from '../generation/GenerationOperationIds';

/** Webview 消息、日志与用户行为。 */
export interface MessagingHostDeps {
  bindPanel: (panel: vscode.WebviewPanel | undefined) => void;
  postMessage: (panel: vscode.WebviewPanel | undefined, msg: BackendMessage) => void;
  beginUiResync: () => void;
  postGenerationProgress: (
    panel: vscode.WebviewPanel,
    operation: GenerationOperationId,
    phase: 'preparing' | 'llm' | 'parsing' | 'validating',
    message: string,
    detail?: string,
  ) => void;
  warn: (message: string) => void;
  /** best-effort 降级（能力受损但流程继续）；结构化落盘。 */
  degraded: (reason: string, context?: Record<string, unknown>) => void;
  error: (message: string) => void;
  debugLog: (stageId: string, event: string, attempt: number, payload?: unknown) => void;
  logUserAction: (kind: string, detail: Record<string, unknown>) => void;
  /** 任务结束写出聚合指标（purpose=metrics）。可选以兼容轻量测试宿主。 */
  flushMetrics?: (reason: string) => void;
}
