/**
 * P1-1：宿主与 webview 共用的消息类型与 type guard（无 vscode 依赖）。
 */
export type { BackendMessage, FrontendMessage } from '../WorkflowDefinition';
export { isBackendMessage, isFrontendMessage } from '../WebviewMessageGuards';
