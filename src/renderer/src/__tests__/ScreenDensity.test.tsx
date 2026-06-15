import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CockpitProvider, useCockpitContext } from '../stagent/cockpit/CockpitContext'
import { DeliveryScreen } from '../stagent/cockpit/screens/DeliveryScreen'
import { ExecutionScreen } from '../stagent/cockpit/screens/ExecutionScreen'
import { initialStagentState } from '../stagent/useStagentEngine'
import type { Stage } from '@stagent/core'

const stage: Stage = {
  id: 'stage_impl_a',
  title: 'Build',
  tool: 'llm-text',
  toolConfig: { type: 'llm-text', systemPrompt: 'x' },
  input: { sources: [], mergeStrategy: 'concat' },
  outputs: [],
  pauseAfter: false,
}

const engineBase = {
  stages: [stage],
  models: [],
  preferredModel: '',
  setModel: vi.fn(),
  getConfig: vi.fn(),
  saveConfig: vi.fn(),
  reviewDecision: vi.fn(),
}

function Toggle(): React.JSX.Element {
  const { showTechnical, setShowTechnical } = useCockpitContext()
  return (
    <button type="button" onClick={() => setShowTechnical(!showTechnical)}>
      toggle
    </button>
  )
}

function clearLs(): void {
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
}

describe('unified screens follow global technical density', () => {
  it('DeliveryScreen technical report folds/unfolds with the global toggle', () => {
    clearLs()
    render(
      <CockpitProvider>
        <Toggle />
        <DeliveryScreen
          engine={{ ...engineBase, state: { ...initialStagentState, completed: true } }}
          form={{
            draft: 'x',
            setDraft: vi.fn(),
            taskType: 'auto',
            setTaskType: vi.fn(),
            workspacePath: '/tmp',
            setWorkspacePath: vi.fn(),
          }}
          onNewTask={vi.fn()}
          send={vi.fn(async () => {})}
        />
      </CockpitProvider>,
    )
    expect(screen.queryByText('做了什么')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }))
    expect(screen.getByText('做了什么')).toBeTruthy()
  })

  it('ExecutionScreen technical section folds/unfolds with the global toggle', () => {
    clearLs()
    render(
      <CockpitProvider>
        <Toggle />
        <ExecutionScreen
          engine={{ ...engineBase, state: { ...initialStagentState, phase: 'execution', stageStatus: { stage_impl_a: 'running' } } }}
          send={vi.fn(async () => {})}
        />
      </CockpitProvider>,
    )
    expect(screen.queryByText('引擎活动')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }))
    // engine activity only shows with feed; structure label always present when expanded
    expect(screen.getByText('结构')).toBeTruthy()
  })
})
