import type * as vscode from '../platform/HostTypes';
import type { ErrorType } from '../WorkflowDefinition';
import {
  emitStageError,
  ERROR_TYPE_INVARIANT_VIOLATION,
  invariantStageError,
} from '../WorkflowStageErrorHelpers';
import type { HitlStateHost, HitlUiHost } from './HitlCoordinatorHost';

/** Tells the user why a HITL action did nothing instead of failing silently. */
export function postHitlActionHint(
  host: HitlUiHost,
  panel: vscode.WebviewPanel,
  message: string,
  stageId?: string,
): void {
  host.postMessage(panel, { type: 'actionHint', message, ...(stageId ? { stageId } : {}) });
}

export function postHitlStageError(
  host: HitlUiHost & Pick<HitlStateHost, 'getInstance'>,
  panel: vscode.WebviewPanel,
  stageId: string,
  error: string,
  errorType: ErrorType,
  options?: { persistLastError?: boolean },
): void {
  emitStageError(
    panel,
    (p, msg) => host.postMessage(p as vscode.WebviewPanel, msg),
    host.getInstance(),
    errorType === ERROR_TYPE_INVARIANT_VIOLATION
      ? invariantStageError(stageId, error)
      : { stageId, error, errorType },
    options,
  );
}
