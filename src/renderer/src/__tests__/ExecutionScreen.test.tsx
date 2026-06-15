import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ExecutionScreen } from '../stagent/cockpit/screens/ExecutionScreen'
import { initialStagentState } from '../stagent/useStagentEngine'
import type { Question, Stage } from '@stagent/core'

const stage: Stage = {
  id: 'stage_impl_a',
  title: 'Build',
  tool: 'llm-text',
  toolConfig: { type: 'llm-text', systemPrompt: 'x' },
  input: { sources: [], mergeStrategy: 'concat' },
  outputs: [],
  pauseAfter: false,
}

function renderExec(over: Partial<typeof initialStagentState>) {
  const send = vi.fn(async () => {})
  render(
    <ExecutionScreen
      engine={{
        state: { ...initialStagentState, phase: 'execution', ...over },
        stages: [stage],
        models: [],
        preferredModel: '',
        setModel: vi.fn(),
        getConfig: vi.fn(),
        saveConfig: vi.fn(),
        reviewDecision: vi.fn(),
      }}
      send={send}
    />,
  )
  return { send }
}

describe('ExecutionScreen (unified) — gates are always on', () => {
  it('renders progress + neutral credibility strip', () => {
    renderExec({ stageStatus: { stage_impl_a: 'running' } })
    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect(screen.getByText(/尚无数据/)).toBeTruthy()
  })

  it('surfaces the decision gate (not auto-approved)', () => {
    renderExec({ decisionStageId: 'stage_impl_a' })
    expect(screen.getByText(/需要你确认一个关键决策/)).toBeTruthy()
    expect(screen.getByText(/决策评审/)).toBeTruthy()
  })

  it('surfaces pending questions gate', () => {
    renderExec({ questionsBefore: { stage_impl_a: [{ id: 'q1', text: '确认吗?' }] as Question[] } })
    expect(screen.getByText(/需要你帮忙看一下/)).toBeTruthy()
  })

  it('surfaces error + retry gate', () => {
    renderExec({ errors: { stage_impl_a: { error: 'boom', errorType: 'x' } } })
    expect(screen.getByRole('button', { name: /重试此阶段/ })).toBeTruthy()
  })

  it('shows failure banner', () => {
    renderExec({ failed: { reason: '执行失败了', errorType: 'x' } })
    expect(screen.getByText(/执行失败了/)).toBeTruthy()
  })
})
