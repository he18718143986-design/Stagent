import type { WebviewPanel } from '../platform/HostTypes';
import type { BackendMessage } from '../WorkflowDefinition';
import type { GenerationUiPort } from './GenerationUiPort';

/** 最小 UI 桥：仅 postMessage，供模块化生成链使用。 */
export class GenerationUiShim implements GenerationUiPort {
  constructor(private readonly send: (msg: BackendMessage) => void) {}

  bindPanel(_panel?: WebviewPanel): void {}

  postMessage(_panel: WebviewPanel, msg: BackendMessage): void {
    this.send(msg);
  }
}
