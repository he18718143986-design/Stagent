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

  it('shows honest copy when the AFK quality gate did not pass', () => {
    const qualityReport = {
      afk: {
        passed: false,
        stableVerificationPasses: 0,
        verificationStages: 1,
        humanInterventions: 3,
        runtimeReplanCount: 0,
        dodDeliverablesSatisfied: 0,
        dodDeliverablesTotal: 1,
        charterCoverageRate: 0,
        flakyStages: [],
        dodConfigured: true,
        reasons: ['tests failed'],
      },
      verificationRows: [{ stageId: 's1', passCount: 0, totalRuns: 1, stable: false, flaky: false }],
      engineSummary: 'x',
    }
    render(
      <DeliveryScreen
        engine={{
          state: { ...initialStagentState, completed: true, workflow, qualityReport },
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
        send={vi.fn(async () => {})}
      />,
    )
    expect(screen.getByText(/有检查没通过/)).toBeTruthy()
    expect(screen.queryByText('做好了！')).toBeNull()
    expect(screen.getByText(/0\/1 项测试通过/)).toBeTruthy()
  })

  it('switches between acceptance and retrospective tabs', () => {
    renderDelivery()
    expect(screen.getByRole('tab', { name: '验收' })).toBeTruthy()
    expect(screen.getByText('验收报告')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '复盘' }))
    expect(screen.getByText('本次复盘')).toBeTruthy()
    expect(screen.queryByText('验收报告')).toBeNull()
  })
})
