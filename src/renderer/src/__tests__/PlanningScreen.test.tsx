import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PlanningScreen } from '../stagent/cockpit/screens/PlanningScreen'
import { initialStagentState } from '../stagent/useStagentEngine'
import type { Stage } from '@stagent/core'

const mockStage: Stage = {
  id: 'stage_impl_a',
  title: 'Build',
  tool: 'llm-text',
  toolConfig: { type: 'llm-text', systemPrompt: 'x' },
  input: { sources: [], mergeStrategy: 'concat' },
  outputs: [],
  pauseAfter: false,
}

const workflow = {
  id: 'w1',
  version: '2.0' as const,
  meta: { title: 'Test', taskType: 'software', userInput: 'x', createdAt: '2026-01-01' },
  stages: [mockStage],
}

function renderPlanning(over: Partial<typeof initialStagentState>, send = vi.fn(async () => {})) {
  return render(
    <PlanningScreen
      engine={{
        state: { ...initialStagentState, phase: 'confirm', workflow, ...over },
        stages: [mockStage],
        models: [],
        preferredModel: '',
        setModel: vi.fn(),
        getConfig: vi.fn(),
        saveConfig: vi.fn(),
        reviewDecision: vi.fn(),
      }}
      form={{
        draft: 'x',
        setDraft: vi.fn(),
        taskType: 'auto',
        setTaskType: vi.fn(),
        workspacePath: '/tmp',
        setWorkspacePath: vi.fn(),
      }}
      onNewTask={vi.fn()}
      send={send}
    />,
  )
}

describe('PlanningScreen (unified)', () => {
  it('disables start gate when blocked and shows red light', () => {
    renderPlanning({ blocked: true, blockReasons: ['lint fail'] })
    const btn = screen.getByRole('button', { name: /看起来不错/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(screen.getByText(/暂时不能开始/)).toBeTruthy()
  })

  it('start gate opens confirm modal and fires startExecution', () => {
    const send = vi.fn(async () => {})
    renderPlanning({}, send)
    fireEvent.click(screen.getByRole('button', { name: /看起来不错/ }))
    const confirm = screen.getByRole('button', { name: /确认，开始制作/ })
    fireEvent.click(confirm)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'startExecution' }))
  })

  it('always renders the credibility strip (neutral when empty)', () => {
    renderPlanning({})
    expect(screen.getByText(/尚无数据/)).toBeTruthy()
  })
})
