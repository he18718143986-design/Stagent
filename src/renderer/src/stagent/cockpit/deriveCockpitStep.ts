import type { StagentState } from '../useStagentEngine'

export type Step = 1 | 2 | 3 | 4 | 5

function isGenerating(state: StagentState): boolean {
  const msg = state.busy?.message ?? ''
  return /生成|工作流|澄清|润色/i.test(msg) || /workflow-gen|clarify/i.test(state.busy?.detail ?? '')
}

/**
 * 统一驾驶舱单一步骤模型(从 1 编号):
 * 1 说需求 · 2 一起对一下 · 3 看看计划 · 4 自动开发 · 5 交付给你
 */
export function deriveStep(state: StagentState): Step {
  if (state.completed) {
    return 5
  }
  if (state.phase === 'execution') {
    return 4
  }
  if (state.phase === 'confirm') {
    return 3
  }
  if (state.phase === 'input' && (state.clarify?.length ?? 0) > 0) {
    return 2
  }
  if (isGenerating(state) && state.phase === 'input') {
    return 2
  }
  return 1
}

export const STEP_LABELS = ['说需求', '一起对一下', '看看计划', '自动开发', '交付给你'] as const
