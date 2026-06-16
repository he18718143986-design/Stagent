import type { Stage } from '@stagent/core'
import { isEngineInsertedStage } from '../components/stageHelpers'

export interface PlanProposalRow {
  id: string
  /** 步骤标题(原始,调用方 humanize)。 */
  step: string
  /** 这步要达成什么(原始 description ?? title)。 */
  purpose: string
  /** 配对的验证阶段标题;无则 null。 */
  verification: string | null
}

export interface PlanProposal {
  rows: PlanProposalRow[]
  verifiedCount: number
  total: number
}

/**
 * 由 stages 派生「实施方案表」:功能步骤(排除引擎插入/test_run)的
 * 目的 + 配对验证(stage_impl_X ↔ stage_test_run_X)。纯函数。
 */
export function buildPlanProposal(stages: Stage[]): PlanProposal {
  const testRunBySuffix = new Map<string, Stage>()
  for (const s of stages) {
    const m = /^stage_test_run_(.+)$/.exec(s.id)
    if (m) {
      testRunBySuffix.set(m[1], s)
    }
  }
  const rows: PlanProposalRow[] = stages
    .filter((s) => !isEngineInsertedStage(s.id) && !/^stage_test_run_/.test(s.id))
    .map((s) => {
      const m = /^stage_impl_(.+)$/.exec(s.id)
      const test = m ? testRunBySuffix.get(m[1]) : undefined
      return {
        id: s.id,
        step: s.title,
        purpose: s.description?.trim() || s.title,
        verification: test?.title ?? null,
      }
    })
  return {
    rows,
    verifiedCount: rows.filter((r) => r.verification).length,
    total: rows.length,
  }
}
