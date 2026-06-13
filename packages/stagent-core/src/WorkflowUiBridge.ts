/**
 * M42：Webview UI 桥 — panel 绑定 + postMessage 推送（含副作用链）。
 */
import type * as vscode from './platform/HostTypes';
import type { BackendMessage, WorkflowInstance } from './WorkflowDefinition';
import type { GenerationOperationId } from './generation/GenerationOperationIds';
import { enrichBackendMessageForWebview } from './BackendMessageEnrichment';
import {
  applyPostMessageDeliveryEffects,
  applyPostMessageSideEffects,
  markStageArtifactsApproved,
  type MessagingHost,
} from './WorkflowEngineMessaging';

export interface WorkflowUiBridgeDeps {
  messagingHost: () => MessagingHost;
  getFeedbackLastAsked: () => string | undefined;
  setFeedbackLastAsked: (iso: string) => Promise<void>;
  getCharterFeedbackLastAsked: () => string | undefined;
  setCharterFeedbackLastAsked: (iso: string) => Promise<void>;
}

/** 轻量 WebviewPanel mock，供单测注入。 */
export interface MockWebviewPanel {
  webview: { postMessage: (msg: BackendMessage) => void | Promise<void> };
}

export class WorkflowUiBridge {
  private activePanel: vscode.WebviewPanel | undefined;
  private nextMessageSeq = 0;
  private uiEpoch = 0;
  private deliveryChain: Promise<void> = Promise.resolve();

  constructor(private readonly deps: WorkflowUiBridgeDeps) {}

  bindPanel(panel: vscode.WebviewPanel | undefined): void {
    if (panel) {
      this.activePanel = panel;
    }
  }

  getActivePanel(): vscode.WebviewPanel | undefined {
    return this.activePanel;
  }

  getUiEpoch(): number {
    return this.uiEpoch;
  }

  /** Resync 边界：清空 outbound backlog 并递增 uiEpoch（recovery burst 前必调）。 */
  beginUiResync(): number {
    this.resetDeliveryChain();
    this.uiEpoch += 1;
    return this.uiEpoch;
  }

  private resetDeliveryChain(): void {
    this.deliveryChain = Promise.resolve();
  }

  postMessage(panel: vscode.WebviewPanel | undefined, msg: BackendMessage): void {
    const p = panel ?? this.activePanel;
    if (!p) {
      return;
    }
    this.nextMessageSeq += 1;
    const seq = this.nextMessageSeq;
    const uiEpoch = this.uiEpoch;
    const host = this.deps.messagingHost();

    this.deliveryChain = this.deliveryChain
      .then(async () => {
        const enriched = enrichBackendMessageForWebview(host, msg, seq, uiEpoch);
        applyPostMessageSideEffects(host, enriched, {
          getLastAsked: this.deps.getFeedbackLastAsked,
          setLastAsked: this.deps.setFeedbackLastAsked,
          getCharterFeedbackLastAsked: this.deps.getCharterFeedbackLastAsked,
          setCharterFeedbackLastAsked: this.deps.setCharterFeedbackLastAsked,
        });
        try {
          const webviewPanel = p as MockWebviewPanel;
          if (webviewPanel?.webview?.postMessage) {
            await Promise.resolve(webviewPanel.webview.postMessage(enriched));
          }
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          host.warn(`webview_post_message_failed type=${enriched.type} err=${err}`);
        }
        applyPostMessageDeliveryEffects(host, p, enriched);
      })
      .catch((e) => {
        const err = e instanceof Error ? e.message : String(e);
        host.warn(`webview_delivery_chain_failed err=${err}`);
      });
  }

  postGenerationProgress(
    panel: vscode.WebviewPanel,
    operation: GenerationOperationId,
    phase: 'preparing' | 'llm' | 'parsing' | 'validating',
    message: string,
    detail?: string,
  ): void {
    this.postMessage(panel, { type: 'generationProgress', operation, phase, message, detail });
  }

  markStageArtifactsApproved(instance: WorkflowInstance | undefined, stageId: string): void {
    markStageArtifactsApproved(instance, stageId);
  }
}
