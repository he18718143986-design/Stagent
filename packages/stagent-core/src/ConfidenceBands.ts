import type { ConfidenceLevel } from './ConfidenceScorer';

/** `computeConfidence` / HITL：score ≥ 此值为 high */
export const CONFIDENCE_LEVEL_HIGH_MIN = 0.75;

/** score ≥ 此值为 medium（低于 high） */
export const CONFIDENCE_LEVEL_MEDIUM_MIN = 0.55;

/** score ≥ 此值为 low（低于 medium）；更低为 critical */
export const CONFIDENCE_LEVEL_LOW_MIN = 0.35;

export function scoreToConfidenceLevel(score: number): ConfidenceLevel {
  if (score >= CONFIDENCE_LEVEL_HIGH_MIN) {
    return 'high';
  }
  if (score >= CONFIDENCE_LEVEL_MEDIUM_MIN) {
    return 'medium';
  }
  if (score >= CONFIDENCE_LEVEL_LOW_MIN) {
    return 'low';
  }
  return 'critical';
}
