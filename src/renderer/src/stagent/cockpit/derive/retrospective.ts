import type { QualityReportPayload, Stage } from '@stagent/core'

export interface RetrospectiveInfo {
  /** 关键决策数(决策阶段数)。 */
  decisions: number
  /** 执行阶段总数。 */
  stages: number
  /** 通过的自动测试数。 */
  testsPassed: number
  /** 自动修复次数(引擎 replan/retry 计数)。 */
  selfHeals: number
  /** 关键决策标题列表。 */
  keyDecisions: string[]
}

const SELF_HEAL_RE = /replan|retry|重试|修复|self.?heal/i

/** 由收尾态派生「复盘报告」指标 + 关键决策。纯函数。 */
export function buildRetrospective(args: {
  stages: Stage[]
  qualityReport?: QualityReportPayload | null
  engineActivityFeed: { kind: string; text: string }[]
}): RetrospectiveInfo {
  const decisionStages = args.stages.filter((s) => s.isDecisionStage)
  const testsPassed = args.qualityReport?.verificationRows.reduce((n, r) => n + r.passCount, 0) ?? 0
  const selfHeals = args.engineActivityFeed.filter(
    (e) => SELF_HEAL_RE.test(e.kind) || SELF_HEAL_RE.test(e.text),
  ).length
  return {
    decisions: decisionStages.length,
    stages: args.stages.length,
    testsPassed,
    selfHeals,
    keyDecisions: decisionStages.map((s) => s.title),
  }
}
