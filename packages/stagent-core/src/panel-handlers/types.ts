import type * as vscode from 'vscode';
import type { FrontendMessage } from '../WorkflowDefinition';
import type { WorkflowEngine } from '../WorkflowEngine';

export interface PanelHandlerContext {
  engine: WorkflowEngine;
  panel: vscode.WebviewPanel;
}

export type PanelHandler = (ctx: PanelHandlerContext, msg: FrontendMessage) => void | Promise<void>;

export type PanelHandlerMap = Partial<Record<FrontendMessage['type'], PanelHandler>>;
