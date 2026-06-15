import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DeliveryScreen } from '../stagent/cockpit/screens/DeliveryScreen'
import { initialStagentState } from '../stagent/useStagentEngine'

const workflow = {
  id: 'w1',
  version: '2.0' as const,
  meta: {
    title: '记账小工具',
    taskType: 'software',
    userInput: 'x',
    createdAt: '2026-01-01',
    taskWorkspacePath: '/tmp/ws',
  },
  stages: [],
}

function renderDelivery(send = vi.fn(async () => {})) {
  render(
    <DeliveryScreen
      engine={{
        state: { ...initialStagentState, completed: true, workflow },
        stages: [],
        models: [],
        preferredModel: '',
        setModel: vi.fn(),
        getConfig: vi.fn(),
        saveConfig: vi.fn(),
        reviewDecision: vi.fn(),
      }}
      form={{
        draft: '',
        setDraft: vi.fn(),
        taskType: 'auto',
        setTaskType: vi.fn(),
        workspacePath: '/tmp/ws',
        setWorkspacePath: vi.fn(),
      }}
      onNewTask={vi.fn()}
      send={send}
    />,
  )
  return { send }
}

describe('DeliveryScreen (unified)', () => {
  it('shows the success hero', () => {
    renderDelivery()
    expect(screen.getByText('做好了！')).toBeTruthy()
  })

  it('download opens the workspace folder', () => {
    const { send } = renderDelivery()
    fireEvent.click(screen.getByRole('button', { name: /下载/ }))
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'openArtifactFile', filePath: '/tmp/ws' }))
  })

  it('opens the how-to panel', () => {
    renderDelivery()
    fireEvent.click(screen.getByRole('button', { name: /怎么用/ }))
    expect(screen.getByText('三步就能上手')).toBeTruthy()
  })
})
