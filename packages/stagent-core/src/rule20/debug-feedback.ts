import { stripRule20WarningSuffix } from '../l10n/rule20Msg';
import type { VerifyIssue, ViolationType, WarningType } from './types';

const DEBUG_FEEDBACK_VIOLATION_TYPES = new Set<WarningType>([
  'debug-feedback-loop-not-first',
  'debug-missing-reproduce-stage',
  'debug-missing-verification-stage',
]);

export function promoteDebugFeedbackWarningsToViolations(
  warnings: VerifyIssue[],
  violations: VerifyIssue[],
  mode: 'off' | 'warn' | 'hard' | undefined,
): void {
  if (mode !== 'hard') {
    return;
  }
  for (let i = warnings.length - 1; i >= 0; i -= 1) {
    const w = warnings[i];
    if (!DEBUG_FEEDBACK_VIOLATION_TYPES.has(w.type as WarningType)) {
      continue;
    }
    warnings.splice(i, 1);
    violations.push({
      type: w.type as ViolationType,
      stageId: w.stageId,
      message: stripRule20WarningSuffix(w.message),
    });
  }
}
