import type { CandidateOutcome } from './BestOfNTypes';

/**
 * Defensive accessors + comparator for ranking best-of-N candidates.
 *
 * Pure and never-throwing: malformed candidates (missing/wrong-typed fields)
 * are coerced to safe sentinel values so ranking stays total and deterministic.
 */

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Missing/invalid `passed` is treated as false. */
export function candidatePassed(candidate: CandidateOutcome | undefined | null): boolean {
  return !!(candidate && candidate.passed === true);
}

/** Missing/invalid `smokePassed` is treated as false. */
export function candidateSmokePassed(candidate: CandidateOutcome | undefined | null): boolean {
  return !!(candidate && candidate.smokePassed === true);
}

/** Missing/invalid quality score sorts last (-Infinity). */
export function candidateQualityScore(candidate: CandidateOutcome | undefined | null): number {
  if (candidate && isFiniteNumber(candidate.qualityScore)) {
    return candidate.qualityScore;
  }
  return -Infinity;
}

/** Missing/invalid `testsFailed` is treated as worst (+Infinity, fewer is better). */
export function candidateTestsFailed(candidate: CandidateOutcome | undefined | null): number {
  if (candidate && isFiniteNumber(candidate.testsFailed)) {
    return candidate.testsFailed;
  }
  return Infinity;
}

/** Missing/invalid `gateViolations` is treated as worst (+Infinity, fewer is better). */
export function candidateGateViolations(candidate: CandidateOutcome | undefined | null): number {
  if (candidate && isFiniteNumber(candidate.gateViolations)) {
    return candidate.gateViolations;
  }
  return Infinity;
}

/** Missing/invalid `testsPassed` is treated as worst (-Infinity, more is better). */
export function candidateTestsPassed(candidate: CandidateOutcome | undefined | null): number {
  if (candidate && isFiniteNumber(candidate.testsPassed)) {
    return candidate.testsPassed;
  }
  return -Infinity;
}

/**
 * Comparator implementing the best-of-N ranking (best sorts first).
 *
 * Order of keys:
 *   passed (true first) -> smokePassed (true first) -> qualityScore (high first)
 *   -> testsFailed (low first) -> gateViolations (low first) -> testsPassed (high first).
 *
 * Returns 0 on a full tie so a stable sort preserves the original order.
 */
export function compareCandidates(a: CandidateOutcome, b: CandidateOutcome): number {
  const passedA = candidatePassed(a);
  const passedB = candidatePassed(b);
  if (passedA !== passedB) {
    return passedA ? -1 : 1;
  }

  const smokeA = candidateSmokePassed(a);
  const smokeB = candidateSmokePassed(b);
  if (smokeA !== smokeB) {
    return smokeA ? -1 : 1;
  }

  const qualityA = candidateQualityScore(a);
  const qualityB = candidateQualityScore(b);
  if (qualityA !== qualityB) {
    return qualityA > qualityB ? -1 : 1;
  }

  const failedA = candidateTestsFailed(a);
  const failedB = candidateTestsFailed(b);
  if (failedA !== failedB) {
    return failedA < failedB ? -1 : 1;
  }

  const gatesA = candidateGateViolations(a);
  const gatesB = candidateGateViolations(b);
  if (gatesA !== gatesB) {
    return gatesA < gatesB ? -1 : 1;
  }

  const testsPassedA = candidateTestsPassed(a);
  const testsPassedB = candidateTestsPassed(b);
  if (testsPassedA !== testsPassedB) {
    return testsPassedA > testsPassedB ? -1 : 1;
  }

  return 0;
}
