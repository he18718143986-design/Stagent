import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SimplePlanningScreen } from '../stagent/cockpit/screens/simple/SimplePlanningScreen'
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

describe('SimplePlanningScreen', () => {
  it('disables start when blocked', () => {
    const send = vi.fn(async () => {})
    render(
      <SimplePlanningScreen
        engine={{
          state: {
            ...initialStagentState,
            phase: 'confirm',
            blocked: true,
            blockReasons: ['lint fail'],
            workflow: {
              id: 'w1',
              version: '2.0',
              meta: { title: 'Test', taskType: 'software', userInput: 'x', createdAt: '2026-01-01' },
              stages: [mockStage],
            },
          },
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
    const btn = screen.getByRole('button', { name: /看起来不错/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })
})
