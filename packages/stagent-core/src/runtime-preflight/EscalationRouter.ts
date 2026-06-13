import type * as vscode from '../platform/HostTypes';
import type { BackendMessage } from '../WorkflowDefinition';

export type WorkflowEscalationChoice = 'confirm' | 'reopen_decision' | 'abort';

export function postWorkflowEscalation(
  postMessage: (panel: unknown, msg: BackendMessage) => void,
  panel: unknown,
  payload: {
    stageId: string;
    issues: string[];
    reopenDecisionStageId?: string;
  },
): void {
  postMessage(panel, {
    type: 'workflowEscalation',
    stageId: payload.stageId,
    issues: payload.issues,
    choices: ['confirm', 'reopen_decision', 'abort'],
    reopenDecisionStageId: payload.reopenDecisionStageId,
  });
}
