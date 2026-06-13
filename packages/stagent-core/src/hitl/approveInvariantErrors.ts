import type * as vscode from '../platform/HostTypes';
import { ERROR_TYPE_INVARIANT_VIOLATION } from '../WorkflowStageErrorHelpers';
import type {
  HitlDiagnosticsHost,
  HitlStateHost,
  HitlUiHost,
} from './HitlCoordinatorHost';
import { postHitlStageError } from './postHitlStageError';

export function postApproveInvariantError(
  host: HitlUiHost & Pick<HitlStateHost, 'getInstance'> & HitlDiagnosticsHost,
  panel: vscode.WebviewPanel,
  stageId: string,
  error: string,
  logKind: string,
): void {
  host.logUserAction(logKind, { stageId });
  postHitlStageError(host, panel, stageId, error, ERROR_TYPE_INVARIANT_VIOLATION);
}
