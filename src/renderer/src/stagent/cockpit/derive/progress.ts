import type { StageStatus } from '@stagent/core'

export interface ProgressStep {
  id: string
  title: string
}

export interface ProgressInfo {
  total: number
  done: number
  /** 0–100 整数百分比；total=0 时为 0。 */
  percent: number
  /** 当前进行中的阶段（优先取活跃阶段，否则取第一个待执行阶段）。 */
  currentStageId: string | null
  currentTitle: string | null
}

const DONE_STATUSES: ReadonlySet<StageStatus> = new Set<StageStatus>(['done', 'skipped'])
const ACTIVE_STATUSES: ReadonlySet<StageStatus> = new Set<StageStatus>([
  'running',
  'retrying',
  'waiting-questions',
  'paused',
])

/**
 * 由计划步骤 + 阶段状态派生英雄进度环所需数据。纯函数,便于单测。
 * 调用方应先用 filterPlanSteps 过滤掉引擎插入/测试运行阶段,只传"功能步骤"。
 */
export function deriveProgress(
  steps: ProgressStep[],
  stageStatus: Record<string, StageStatus>,
): ProgressInfo {
  const total = steps.length
  let done = 0
  let active: ProgressStep | null = null
  let firstPending: ProgressStep | null = null

  for (const s of steps) {
    const st = stageStatus[s.id] ?? 'pending'
    if (DONE_STATUSES.has(st)) {
      done += 1
      continue
    }
    if (active === null && ACTIVE_STATUSES.has(st)) {
      active = s
    }
    if (firstPending === null && st === 'pending') {
      firstPending = s
    }
  }

  const current = active ?? firstPending
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)

  return {
    total,
    done,
    percent,
    currentStageId: current?.id ?? null,
    currentTitle: current?.title ?? null,
  }
}
