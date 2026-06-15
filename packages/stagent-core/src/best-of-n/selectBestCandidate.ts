import type { BestOfNSelection, CandidateOutcome } from './BestOfNTypes';
import { candidatePassed, compareCandidates } from './candidateRank';

/**
 * best-of-N gated selection policy (pure, never-throwing).
 *
 * Given N candidate Strict QA outcomes, rank them best -> worst and pick the
 * best passing candidate (or report that all candidates failed). This slice does
 * NOT run sampling or touch the executor — it only decides which candidate wins.
 */
export function selectBestCandidate(candidates: CandidateOutcome[]): BestOfNSelection {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { selectedId: null, reason: '无候选', ranked: [] };
  }

  // Stable sort: compareCandidates returns 0 on full ties, so original order
  // is preserved among equally-ranked candidates.
  const ranked = candidates.slice().sort(compareCandidates);

  const winner = ranked.find((candidate) => candidatePassed(candidate));
  if (winner) {
    return {
      selectedId: winner.id,
      reason: `已选通过 Strict QA 的最优候选 ${winner.id}`,
      ranked,
    };
  }

  return {
    selectedId: null,
    reason: `${candidates.length} 个候选均未通过 Strict QA`,
    ranked,
  };
}

/**
 * Defensive tally of candidate pass/fail counts. Non-array input yields all-zero.
 */
export function summarizeCandidates(candidates: CandidateOutcome[]): {
  total: number;
  passed: number;
  failed: number;
} {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { total: 0, passed: 0, failed: 0 };
  }

  let passed = 0;
  for (const candidate of candidates) {
    if (candidatePassed(candidate)) {
      passed += 1;
    }
  }

  return { total: candidates.length, passed, failed: candidates.length - passed };
}
