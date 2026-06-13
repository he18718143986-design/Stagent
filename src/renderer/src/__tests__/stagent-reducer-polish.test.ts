/**
 * 回归测试：执行前的「润色 / 工作流生成」流式增量（traceStageId 为
 * task-polish / clarify-questions* / workflow-gen*）不应把 UI 切到 execution 阶段，
 * 否则会离开 input 视图、导致润色结果（仅在 input 阶段渲染）永远不可见。
 */
import { describe, it, expect } from 'vitest'
import { reduceStagentState, initialStagentState } from '../stagent/useStagentEngine'

const chunk = (stageId: string) =>
  ({ kind: 'event' as const, msg: { type: 'streamChunk' as const, stageId, chunk: 'x' } })

describe('reduceStagentState streamChunk phase handling', () => {
  it('keeps phase=input while task-polish streams', () => {
    const next = reduceStagentState(initialStagentState, chunk('task-polish'))
    expect(next.phase).toBe('input')
    expect(next.streams['task-polish']).toBe('x')
  })

  it('keeps phase=input while workflow-gen / repair stream', () => {
    const gen = reduceStagentState(initialStagentState, chunk('workflow-gen'))
    expect(gen.phase).toBe('input')
    const repair = reduceStagentState(initialStagentState, chunk('workflow-gen-repair'))
    expect(repair.phase).toBe('input')
  })

  it('keeps phase=input while clarify-questions streams', () => {
    const next = reduceStagentState(initialStagentState, chunk('clarify-questions'))
    expect(next.phase).toBe('input')
    expect(next.streams['clarify-questions']).toBe('x')
  })

  it('clarifyQuestions stays on input phase even after clarify stream switched phase wrongly', () => {
    let s = reduceStagentState(initialStagentState, chunk('clarify-questions'))
    // 模拟旧 bug：澄清流式增量误切到 execution
    s = { ...s, phase: 'execution' }
    s = reduceStagentState(s, {
      kind: 'event',
      msg: {
        type: 'clarifyQuestions',
        questions: [{ id: 'q1', text: '框架选型？', options: ['RN', 'Flutter'] }],
      },
    })
    expect(s.phase).toBe('input')
    expect(s.clarify?.length).toBe(1)
    expect(s.busy).toBeNull()
  })

  it('userTaskPolished result is rendered (stays in input phase) after polish streaming', () => {
    let s = reduceStagentState(initialStagentState, chunk('task-polish'))
    s = reduceStagentState(s, {
      kind: 'event',
      msg: { type: 'userTaskPolished', text: '润色后的需求', polishedAt: '2026-05-30T12:00:00.000Z', fromCache: false },
    })
    expect(s.phase).toBe('input')
    expect(s.busy).toBeNull()
    expect(s.polished?.text).toBe('润色后的需求')
  })

  it('real stage streamChunk still switches to execution phase', () => {
    const next = reduceStagentState(initialStagentState, chunk('stage_impl_prototype_reader'))
    expect(next.phase).toBe('execution')
  })
})

describe('reduceStagentState fileTreeRevision (产物刷新信号)', () => {
  it('bumps on stageArtifactHints', () => {
    const next = reduceStagentState(initialStagentState, {
      kind: 'event',
      msg: {
        type: 'stageArtifactHints',
        stageId: 'stage_impl_prototype_reader',
        artifacts: [{ filePath: 'reader.py', canDiff: false }],
      },
    })
    expect(next.fileTreeRevision).toBe(1)
    expect(next.artifacts['stage_impl_prototype_reader']?.[0]?.filePath).toBe('reader.py')
  })

  it('bumps only when a stage transitions to done (not on running)', () => {
    const running = reduceStagentState(initialStagentState, {
      kind: 'event',
      msg: { type: 'stageStatusUpdate', stageId: 's1', status: 'running' },
    })
    expect(running.fileTreeRevision).toBe(0)
    const done = reduceStagentState(running, {
      kind: 'event',
      msg: { type: 'stageStatusUpdate', stageId: 's1', status: 'done' },
    })
    expect(done.fileTreeRevision).toBe(1)
  })

  it('bumps on workflowCompleted and downstreamReset', () => {
    const completed = reduceStagentState(initialStagentState, {
      kind: 'event',
      msg: { type: 'workflowCompleted' },
    })
    expect(completed.fileTreeRevision).toBe(1)
    const reset = reduceStagentState(completed, {
      kind: 'event',
      msg: {
        type: 'downstreamReset',
        decisionStageId: 'd1',
        resetStageIds: ['s2'],
        resetStageTitles: ['阶段2'],
      },
    })
    expect(reset.fileTreeRevision).toBe(2)
  })
})

describe('reduceStagentState draftInstanceKey (确认页草稿)', () => {
  const wf = {
    id: 'wf',
    version: '2.0',
    meta: { title: 't', taskType: 'prototype', userInput: 'x', createdAt: '' },
    stages: [],
  } as never

  it('workflowGenerated 写入 draftInstanceKey 并进入 confirm', () => {
    const next = reduceStagentState(initialStagentState, {
      kind: 'event',
      msg: { type: 'workflowGenerated', workflow: wf, instanceKey: 'draft-123' },
    })
    expect(next.phase).toBe('confirm')
    expect(next.draftInstanceKey).toBe('draft-123')
    expect(next.activeInstanceKey).toBe('draft-123')
  })

  it('instanceResumed 进入 execution 并设置 activeInstanceKey 与 failed 横幅', () => {
    const next = reduceStagentState(initialStagentState, {
      kind: 'event',
      msg: {
        type: 'instanceResumed',
        resync: true,
        instanceKey: 'inst-failed',
        workflow: wf,
        instanceStatus: 'failed',
        stageStatuses: { s1: 'error' },
        failedStageId: 's1',
        failedSummary: { error: 'boom', errorType: 'tool-execution-failed' },
      },
    })
    expect(next.phase).toBe('execution')
    expect(next.activeInstanceKey).toBe('inst-failed')
    expect(next.failed?.reason).toBe('boom')
    expect(next.stageStatus).toEqual({ s1: 'error' })
    expect(next.focusFailedStageId).toBe('s1')
    expect(next.engineActivityFeed).toEqual([])
  })

  it('reset 清空 draftInstanceKey', () => {
    const gen = reduceStagentState(initialStagentState, {
      kind: 'event',
      msg: { type: 'workflowGenerated', workflow: wf, instanceKey: 'draft-123' },
    })
    const after = reduceStagentState(gen, { kind: 'reset' })
    expect(after.draftInstanceKey).toBeUndefined()
    expect(after.activeInstanceKey).toBeUndefined()
    expect(after.phase).toBe('input')
  })
})

describe('reduceStagentState workflowFailed (#6 UI 一致)', () => {
  it('workflowFailed 设置 failed 横幅、execution 阶段与 stageStatus error', () => {
    const next = reduceStagentState(initialStagentState, {
      kind: 'event',
      msg: {
        type: 'workflowFailed',
        reason: 'code-runner exitCode=1',
        errorType: 'tool-execution-failed',
        stageId: 'stage_test',
      },
    })
    expect(next.phase).toBe('execution')
    expect(next.failed?.reason).toBe('code-runner exitCode=1')
    expect(next.stageStatus.stage_test).toBe('error')
  })
})

describe('reduceStagentState selectTask (#10 多实例)', () => {
  it('selectTask 更新 activeInstanceKey', () => {
    const next = reduceStagentState(initialStagentState, {
      kind: 'selectTask',
      instanceKey: 'inst-b',
    })
    expect(next.activeInstanceKey).toBe('inst-b')
  })
})

import { shouldDropStaleMessage } from '../stagent/stagentSeqGate'

describe('shouldDropStaleMessage seq/uiEpoch gating', () => {
  it('drops stageStatusUpdate when seq regresses', () => {
    const cursor = { lastSeq: 5, uiEpoch: 1 }
    expect(
      shouldDropStaleMessage(
        { type: 'stageStatusUpdate', stageId: 's1', status: 'running', seq: 3, uiEpoch: 1 },
        cursor,
      ),
    ).toBe(true)
    expect(cursor.lastSeq).toBe(5)
  })

  it('accepts newer seq and advances cursor', () => {
    const cursor = { lastSeq: 2, uiEpoch: 1 }
    expect(
      shouldDropStaleMessage(
        { type: 'stageError', stageId: 's1', error: 'x', errorType: 'generic', seq: 4, uiEpoch: 1 },
        cursor,
      ),
    ).toBe(false)
    expect(cursor.lastSeq).toBe(4)
  })

  it('resync on instanceResumed bumps uiEpoch and resets seq', () => {
    const cursor = { lastSeq: 9, uiEpoch: 2 }
    expect(
      shouldDropStaleMessage(
        {
          type: 'instanceResumed',
          instanceKey: 'k1',
          workflow: { id: 'w', version: '2.0', meta: { title: 't', taskType: 'software', userInput: '', createdAt: '' }, stages: [] },
          instanceStatus: 'running',
          resync: true,
          uiEpoch: 3,
        },
        cursor,
      ),
    ).toBe(false)
    expect(cursor.uiEpoch).toBe(3)
    expect(cursor.lastSeq).toBe(0)
  })
})

describe('reduceStagentState instanceSwitchBlocked (#5)', () => {
  it('instanceSwitchBlocked 设置 switchBlocked 提示', () => {
    const next = reduceStagentState(initialStagentState, {
      kind: 'event',
      msg: {
        type: 'instanceSwitchBlocked',
        reason: '当前任务正在执行阶段',
        targetInstanceKey: 'inst-b',
        activeInstanceKey: 'inst-a',
      },
    })
    expect(next.switchBlocked?.reason).toContain('执行')
    expect(next.switchBlocked?.targetInstanceKey).toBe('inst-b')
  })
})
