import type { StageConfidence } from '../../useStagentEngine'

export type ConfidenceLevel = StageConfidence['level']

export interface CredibilityInfo {
  /** 'empty' 表示尚无可信度数据（执行前的中性态）。 */
  state: 'empty' | 'ready'
  count: number
  /** 各阶段置信分均值（0–100 整数）。 */
  averagePercent: number
  /** 整体等级:取最差(最保守)的等级——单个 critical 即拉低整体。 */
  overallLevel: ConfidenceLevel | null
  counts: Record<ConfidenceLevel, number>
  /** 最差等级阶段的理由,用于带内提示。 */
  lowestReasons: string[]
}

const LEVEL_RANK: Record<ConfidenceLevel, number> = {
  critical: 0,
  low: 1,
  medium: 2,
  high: 3,
}

function emptyCounts(): Record<ConfidenceLevel, number> {
  return { high: 0, medium: 0, low: 0, critical: 0 }
}

/**
 * 由逐阶段置信度派生常驻"可信度带"所需数据。纯函数,便于单测。
 * 无数据时返回中性 'empty' 态,避免在执行前显示误导性的 0%。
 */
export function deriveCredibility(
  confidence: Record<string, StageConfidence>,
): CredibilityInfo {
  const entries = Object.values(confidence)
  const counts = emptyCounts()

  if (entries.length === 0) {
    return { state: 'empty', count: 0, averagePercent: 0, overallLevel: null, counts, lowestReasons: [] }
  }

  let scoreSum = 0
  let worst: StageConfidence | null = null
  for (const e of entries) {
    counts[e.level] += 1
    scoreSum += e.score
    if (worst === null || LEVEL_RANK[e.level] < LEVEL_RANK[worst.level]) {
      worst = e
    }
  }

  return {
    state: 'ready',
    count: entries.length,
    averagePercent: Math.round((scoreSum / entries.length) * 100),
    overallLevel: worst!.level,
    counts,
    lowestReasons: worst!.reasons ?? [],
  }
}
