import type { StageStatus } from '@stagent/core'

export type ActivityState = 'waiting-you' | 'self-heal' | 'working' | 'wrapping'

export interface ExecutionActivity {
  state: ActivityState
  /** 当前阶段标题(原始,调用方再 humanize)。 */
  currentTitle: string | null
  /** 自愈次数(取自引擎活动 feed 的 replan/retry 计数;retrying 时至少 1)。 */
  selfHealAttempts: number
}

const SELF_HEAL_RE = /replan|retry|重试|修复|self.?heal/i

export interface ExecutionActivityInput {
  stages: { id: string; title: string }[]
  stageStatus: Record<string, StageStatus>
  decisionStageId?: string
  pausedStageId?: string
  questionsBefore: Record<string, unknown[]>
  questions: Record<string, unknown[]>
  engineActivityFeed: { kind: string; text: string }[]
}

/** 由执行态派生一行"活动状态":等你 > 自愈 > 工作中 > 收尾。纯函数。 */
export function deriveExecutionActivity(s: ExecutionActivityInput): ExecutionActivity {
  const hasQuestions =
    Object.values(s.questionsBefore).some((q) => q?.length) ||
    Object.values(s.questions).some((q) => q?.length)
  if (s.decisionStageId || s.pausedStageId || hasQuestions) {
    return { state: 'waiting-you', currentTitle: null, selfHealAttempts: 0 }
  }
  const feedHeals = s.engineActivityFeed.filter(
    (e) => SELF_HEAL_RE.test(e.kind) || SELF_HEAL_RE.test(e.text),
  ).length
  const retrying = s.stages.find((st) => s.stageStatus[st.id] === 'retrying')
  if (retrying) {
    return { state: 'self-heal', currentTitle: retrying.title, selfHealAttempts: Math.max(1, feedHeals) }
  }
  const running = s.stages.find((st) => s.stageStatus[st.id] === 'running')
  if (running) {
    return { state: 'working', currentTitle: running.title, selfHealAttempts: feedHeals }
  }
  return { state: 'wrapping', currentTitle: null, selfHealAttempts: feedHeals }
}

/** 执行起点:取引擎活动 feed 最早时间戳,无则用挂载时刻。纯函数。 */
export function pickExecutionStart(feed: { timestamp?: string }[], mountTime: number): number {
  let earliest: number | null = null
  for (const e of feed) {
    if (e.timestamp) {
      const t = Date.parse(e.timestamp)
      if (!Number.isNaN(t) && (earliest === null || t < earliest)) {
        earliest = t
      }
    }
  }
  return earliest ?? mountTime
}

/** 毫秒 → "Ns" / "M分SS秒"。纯函数。 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const sec = total % 60
  return m === 0 ? `${sec}秒` : `${m}分${String(sec).padStart(2, '0')}秒`
}
