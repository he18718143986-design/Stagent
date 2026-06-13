export function shouldShowQualitySoftPrompt(totalChecks: number, checkedCount: number): boolean {
  if (totalChecks <= 0) {
    return false;
  }
  return checkedCount < totalChecks;
}

export function getUncheckedCount(totalChecks: number, checkedCount: number): number {
  return Math.max(0, totalChecks - checkedCount);
}

export function shouldShowDecisionConflictBanner(approvedDecisionCount: number): boolean {
  return approvedDecisionCount >= 2;
}

export type DecisionApproveAction = 'approve-now' | 'show-soft-prompt';

export function getDecisionApproveAction(totalChecks: number, checkedCount: number): DecisionApproveAction {
  return shouldShowQualitySoftPrompt(totalChecks, checkedCount) ? 'show-soft-prompt' : 'approve-now';
}

export function shouldAskRetryConfirm(approvedDecisionCount: number): boolean {
  return approvedDecisionCount >= 1;
}

export function canProceedRetry(approvedDecisionCount: number, userConfirmed: boolean): boolean {
  if (!shouldAskRetryConfirm(approvedDecisionCount)) {
    return true;
  }
  return userConfirmed;
}
