import type * as vscode from '../platform/HostTypes';
import { evaluateManualRetryLimit } from '../ManualRetryLimit';
import { ERROR_TYPE_RETRY_LIMIT_EXCEEDED } from '../WorkflowStageErrorHelpers';
import type {
  HitlDiagnosticsHost,
  HitlStateHost,
  HitlUiHost,
} from './HitlCoordinatorHost';
import { postHitlStageError } from './postHitlStageError';

export function enforceRetryLimitOrReject(
  host: HitlStateHost & HitlUiHost & HitlDiagnosticsHost,
  panel: vscode.WebviewPanel,
  stageId: string,
  retryCount: number,
): boolean {
  const maxManualStageRetries = host.getMaxManualStageRetries();
  const limit = evaluateManualRetryLimit(retryCount, maxManualStageRetries);
  if (limit.allowed) {
    return true;
  }
  host.logUserAction('retry_rejected', {
    stageId,
    retryCount,
    maxManualStageRetries,
    reason: ERROR_TYPE_RETRY_LIMIT_EXCEEDED,
  });
  postHitlStageError(host, panel, stageId, limit.message, ERROR_TYPE_RETRY_LIMIT_EXCEEDED, {
    persistLastError: false,
  });
  return false;
}
