import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IntentScreen } from '../stagent/cockpit/screens/IntentScreen'
import { initialStagentState } from '../stagent/useStagentEngine'

function renderIntent(opts: { draft?: string; onStartClarifyFlow?: () => void } = {}) {
  const onStartClarifyFlow = opts.onStartClarifyFlow ?? vi.fn()
  render(
    <IntentScreen
      engine={{
        state: initialStagentState,
        stages: [],
        models: [],
        preferredModel: '',
        setModel: vi.fn(),
        getConfig: vi.fn(),
        saveConfig: vi.fn(),
        reviewDecision: vi.fn(),
      }}
      form={{
        draft: opts.draft ?? '',
        setDraft: vi.fn(),
        taskType: 'auto',
        setTaskType: vi.fn(),
        workspacePath: '/tmp',
        setWorkspacePath: vi.fn(),
      }}
      onNewTask={vi.fn()}
      send={vi.fn(async () => {})}
      onStartClarifyFlow={onStartClarifyFlow}
      showSettings={false}
      setShowSettings={vi.fn()}
    />,
  )
  return { onStartClarifyFlow }
}

describe('IntentScreen (unified)', () => {
  it('disables primary action with empty draft', () => {
    renderIntent({ draft: '' })
    const btn = screen.getByRole('button', { name: /开始做/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('starts clarify flow on primary action', () => {
    const { onStartClarifyFlow } = renderIntent({ draft: '做个记账工具' })
    fireEvent.click(screen.getByRole('button', { name: /开始做/ }))
    expect(onStartClarifyFlow).toHaveBeenCalled()
  })

  it('reveals advanced options (bypass generate) when expanded', () => {
    renderIntent({ draft: '做个记账工具' })
    fireEvent.click(screen.getByRole('button', { name: /高级选项/ }))
    expect(screen.getByText(/直接生成工作流/)).toBeTruthy()
  })
})
