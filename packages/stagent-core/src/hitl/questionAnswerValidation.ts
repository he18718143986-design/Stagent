import type * as vscode from '../platform/HostTypes';
import type { Question } from '../workflow-types/StageTypes';
import { validateRequiredAnswers } from '../QuestionAfterFlow';
import { ERROR_TYPE_INVARIANT_VIOLATION } from '../WorkflowStageErrorHelpers';
import type {
  HitlDiagnosticsHost,
  HitlStateHost,
  HitlUiHost,
} from './HitlCoordinatorHost';
import { postHitlStageError } from './postHitlStageError';

type QuestionValidationHost = HitlUiHost &
  Pick<HitlStateHost, 'getInstance'> &
  HitlDiagnosticsHost;

export function postMissingAnswersStageError(
  host: QuestionValidationHost,
  panel: vscode.WebviewPanel,
  stageId: string,
  missingIds: string[],
  logKind: string,
): void {
  host.logUserAction(logKind, { stageId, missingIds });
  postHitlStageError(
    host,
    panel,
    stageId,
    `I-8: 必答问题答案为空：${missingIds.join('、')}。请补全后重新提交。`,
    ERROR_TYPE_INVARIANT_VIOLATION,
  );
}

export function validateAnswersOrPostError(
  host: QuestionValidationHost,
  panel: vscode.WebviewPanel,
  stageId: string,
  questions: Question[] | undefined,
  answers: Record<string, string>,
  rejectedLogKind: string,
): boolean {
  const requiredCheck = validateRequiredAnswers(questions, answers);
  if (!requiredCheck.ok) {
    postMissingAnswersStageError(host, panel, stageId, requiredCheck.missingIds, rejectedLogKind);
    return false;
  }
  return true;
}
