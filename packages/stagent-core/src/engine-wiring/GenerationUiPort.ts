import type { WebviewPanel } from '../platform/HostTypes';
import type { BackendMessage } from '../WorkflowDefinition';

/** 模块化生成链所需的最小 UI 端口。 */
export interface GenerationUiPort {
  bindPanel(panel?: WebviewPanel): void;
  postMessage(panel: WebviewPanel, msg: BackendMessage): void;
}
