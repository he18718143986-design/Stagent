import type { StagentState } from '../useStagentEngine'

export type UiMode = 'simple' | 'pro'

export type SimpleStep = 1 | 2 | 3 | 4
export type ProStep = 0 | 1 | 2 | 3 | 4 | 5

export type CockpitStep = SimpleStep | ProStep

function isGenerating(state: StagentState): boolean {
  const msg = state.busy?.message ?? ''
  return /生成|工作流|澄清|润色/i.test(msg) || /workflow-gen|clarify/i.test(state.busy?.detail ?? '')
}

/** 简单模式 4 步 stepper */
export function deriveSimpleStep(state: StagentState): SimpleStep {
  if (state.completed) {
    return 4
  }
  if (state.phase === 'execution') {
    return 3
  }
  if (state.phase === 'confirm' || (state.phase === 'input' && (state.clarify?.length ?? 0) > 0)) {
    return 2
  }
  if (isGenerating(state) && state.phase === 'input') {
    return 2
  }
  return 1
}

/** 专业模式 6 屏 stepper */
export function deriveProStep(state: StagentState): ProStep {
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
    return 1
  }
  if (isGenerating(state) && state.phase === 'input') {
    return 2
  }
  return 0
}

export function deriveCockpitStep(state: StagentState, mode: UiMode): CockpitStep {
  return mode === 'simple' ? deriveSimpleStep(state) : deriveProStep(state)
}

export const SIMPLE_STEP_LABELS = ['说需求', '一起对一下', '自动开发', '交付给你'] as const
export const PRO_STEP_LABELS = [
  '主旨·信封',
  '深澄清',
  '规划驾驶舱',
  '计划签字',
  '执行·验证',
  '质量报告',
] as const
