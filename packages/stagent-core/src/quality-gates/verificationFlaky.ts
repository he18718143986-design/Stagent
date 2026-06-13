export interface VerificationRunRecord {
  attempt: number;
  exitCode: number;
  stdoutHash?: string;
}

export interface VerificationFlakySummary {
  totalRuns: number;
  passCount: number;
  failCount: number;
  stable: boolean;
  flaky: boolean;
  runs: VerificationRunRecord[];
}

export function summarizeVerificationRuns(runs: VerificationRunRecord[]): VerificationFlakySummary {
  const passCount = runs.filter((r) => r.exitCode === 0).length;
  const failCount = runs.length - passCount;
  const stable = runs.length > 0 && passCount === runs.length;
  const flaky = runs.length > 1 && passCount > 0 && failCount > 0;
  return {
    totalRuns: runs.length,
    passCount,
    failCount,
    stable,
    flaky,
    runs,
  };
}

/** 全部通过且无不稳定 pass/fail 交替 → 可给高置信；flaky → 降权。 */
export function confidenceScoreForFlakySummary(summary: VerificationFlakySummary): number {
  if (summary.flaky) {
    return 0.45;
  }
  if (summary.stable && summary.passCount === summary.totalRuns) {
    return summary.totalRuns > 1 ? 0.95 : 0.92;
  }
  return 0.35;
}
