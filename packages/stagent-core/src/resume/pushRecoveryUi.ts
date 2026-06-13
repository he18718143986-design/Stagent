import type { WebviewPanel } from '../platform/HostTypes';
import type { BackendMessage, WorkflowInstance } from '../WorkflowDefinition';
import { BUILTIN_WARNING_RESTORED_FROM_PERSISTENCE } from '../lint/WorkflowWarningTokens';
import { formatWorkflowGeneratedWarningsForDisplay } from '../Rule20WarningDisplay';
import { withSessionFields } from '../InstanceSession';
import { buildExecutionRecoveryMessages } from '../WorkflowRecoveryViewModel';
import type { ResumeCoordinatorHost } from './types';

export interface PanelUiPoster {
  postMessage(panel: WebviewPanel, msg: BackendMessage): void;
  beginUiResync(): void;
}

function postExecutionRecoveryMessages(
  poster: PanelUiPoster,
  panel: WebviewPanel,
  instance: WorkflowInstance,
  instanceKey: string,
): void {
  for (const msg of buildExecutionRecoveryMessages(instance, instanceKey)) {
    poster.postMessage(panel, msg);
  }
}

export function pushIdleRestoredWorkflowForPanel(
  poster: PanelUiPoster,
  panel: WebviewPanel,
  instance: WorkflowInstance,
  instanceKey: string,
): void {
  const warnings = [BUILTIN_WARNING_RESTORED_FROM_PERSISTENCE];
  poster.postMessage(panel, {
    type: 'workflowGenerated',
    workflow: instance.definition,
    warnings,
    warningsDisplay: formatWorkflowGeneratedWarningsForDisplay(warnings),
    ...withSessionFields(instanceKey),
  });
}

export function pushExecutionRecoveryUiForPanel(
  poster: PanelUiPoster,
  panel: WebviewPanel,
  instance: WorkflowInstance,
  instanceKey: string,
): void {
  poster.beginUiResync();
  postExecutionRecoveryMessages(poster, panel, instance, instanceKey);
}

export function pushIdleRestoredWorkflow(
  host: ResumeCoordinatorHost,
  panel: WebviewPanel,
  instance: WorkflowInstance,
  instanceKey: string,
): void {
  host.beginUiResync();
  pushIdleRestoredWorkflowForPanel(makeHostPoster(host), panel, instance, instanceKey);
}

export function pushExecutionRecoveryUi(
  host: ResumeCoordinatorHost,
  panel: WebviewPanel,
  instance: WorkflowInstance,
  instanceKey: string,
): void {
  pushExecutionRecoveryUiForPanel(makeHostPoster(host), panel, instance, instanceKey);
}

/** Webview 重载后把当前活跃实例 UI 快照推回前端（不触发继续执行）。 */
export function resyncActiveInstancePanelUi(
  poster: PanelUiPoster,
  panel: WebviewPanel,
  instance: WorkflowInstance,
  instanceKey: string,
): void {
  poster.beginUiResync();
  if (instance.status === 'idle') {
    pushIdleRestoredWorkflowForPanel(poster, panel, instance, instanceKey);
    return;
  }
  postExecutionRecoveryMessages(poster, panel, instance, instanceKey);
}

function makeHostPoster(host: ResumeCoordinatorHost): PanelUiPoster {
  return {
    postMessage: (p, m) => host.postMessage(p, m),
    beginUiResync: () => host.beginUiResync(),
  };
}
