/**
 * TaskTree 恢复按钮：按 recoverable 过滤，并按状态显示文案。
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { TaskListItem } from '@stagent/core'
import TaskTree from '../pages/TaskTree'

function renderTasks(tasks: TaskListItem[]): void {
  render(
    <TaskTree
      tasks={tasks}
      selectedTaskKey={null}
      selectedFilePath={null}
      onSelectTask={() => {}}
      onSelectFile={() => {}}
      onNewTask={() => {}}
      onResume={() => {}}
      onRemove={() => {}}
    />,
  )
}

describe('TaskTree 恢复按钮过滤', () => {
  it('completed 且 recoverable=false 时不显示恢复', () => {
    renderTasks([
      {
        instanceKey: 'c1',
        title: '已完成任务',
        taskType: 'auto',
        status: 'completed',
        recoverable: false,
        stageCount: 2,
        completedStages: 2,
        createdAt: '',
        userInput: '',
      } as TaskListItem,
    ])
    expect(screen.queryByText('继续确认')).toBeNull()
    expect(screen.queryByText('继续执行')).toBeNull()
    expect(screen.queryByText('继续处理')).toBeNull()
    expect(screen.getByText('删除')).toBeTruthy()
  })

  it('error 且 recoverable=true 时显示「继续处理」', () => {
    renderTasks([
      {
        instanceKey: 'e1',
        title: '失败任务',
        taskType: 'auto',
        status: 'error',
        recoverable: true,
        stageCount: 3,
        completedStages: 1,
        createdAt: '',
        userInput: '',
      } as TaskListItem,
    ])
    expect(screen.getByText('继续处理')).toBeTruthy()
  })
})
