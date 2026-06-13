import * as vscode from 'vscode';
import type { PanelHandlerMap } from './types';

export const workspaceHandlers: PanelHandlerMap = {
  webviewReady: ({ engine, panel }) => {
    engine.instances.resyncPanelUi(panel);
  },
  pickTaskWorkspaceFolder: async ({ panel }) => {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: '选择工作文件夹',
    });
    if (picked?.[0]) {
      await panel.webview.postMessage({ type: 'taskWorkspacePathPicked', path: picked[0].fsPath });
    }
  },
};
