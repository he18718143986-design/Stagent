import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IntakeChatScreen } from '../stagent/cockpit/screens/IntakeChatScreen'
import { initialStagentState } from '../stagent/useStagentEngine'

function setup(over: Partial<typeof initialStagentState> = {}, opts: { draft?: string } = {}) {
  const send = vi.fn(async () => {})
  const onStartClarifyFlow = vi.fn()
  render(
    <IntakeChatScreen
      engine={{
        state: { ...initialStagentState, ...over },
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
      send={send}
      onStartClarifyFlow={onStartClarifyFlow}
      showSettings={false}
      setShowSettings={vi.fn()}
    />,
  )
  return { send, onStartClarifyFlow }
}

describe('IntakeChatScreen', () => {
  it('opens with an AI greeting and a disabled send on empty draft', () => {
    setup()
    expect(screen.getByText(/想做点什么/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /发送/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('sends the requirement (starts clarify flow) when draft is present', () => {
    const { onStartClarifyFlow } = setup({}, { draft: '做个记账工具' })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    expect(onStartClarifyFlow).toHaveBeenCalled()
  })

  it('renders clarify questions as chat chips and submits with recommended answers', () => {
    const { send } = setup(
      { clarify: [{ id: 'q1', text: '输入方式?', options: ['命令行（推荐）', '交互输入'] }] },
      { draft: '做个记账工具' },
    )
    expect(screen.getByText(/几个小问题/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /都按推荐/ }))
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'generateWorkflow', clarifyAnswers: { q1: '命令行（推荐）' } }),
    )
  })
})
