/**
 * TaskTree 删除三档弹层：选择力度后把所选 scope 正确传给 onRemove。
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { TaskListItem } from '@stagent/core'
import TaskTree from '../pages/TaskTree'

const task: TaskListItem = {
  instanceKey: 'inst-1',
  title: '本地脚本',
  taskType: 'prototype',
  status: 'completed',
  stageCount: 3,
  completedStages: 3,
  taskWorkspacePath: '/tmp/work/task-a',
  recoverable: false,
} as unknown as TaskListItem

function renderTree(onRemove: (key: string, scope: string) => void): void {
  render(
    <TaskTree
      tasks={[task]}
      selectedTaskKey={null}
      selectedFilePath={null}
      onSelectTask={() => {}}
      onSelectFile={() => {}}
      onNewTask={() => {}}
      onResume={() => {}}
      onRemove={onRemove as (key: string, scope: 'record' | 'artifacts' | 'folder') => void}
    />,
  )
}

describe('TaskTree 删除三档弹层', () => {
  it('默认 record：确认删除回传 scope=record', () => {
    const onRemove = vi.fn()
    renderTree(onRemove)
    fireEvent.click(screen.getByText('删除'))
    fireEvent.click(screen.getByText('确认删除'))
    expect(onRemove).toHaveBeenCalledWith('inst-1', 'record')
  })

  it('选「连同任务新建的产物」后回传 scope=artifacts', () => {
    const onRemove = vi.fn()
    renderTree(onRemove)
    fireEvent.click(screen.getByText('删除'))
    fireEvent.click(screen.getByText('连同任务新建的产物'))
    fireEvent.click(screen.getByText('确认删除'))
    expect(onRemove).toHaveBeenCalledWith('inst-1', 'artifacts')
  })

  it('选「整个工作文件夹」展示路径与不可逆警告，回传 scope=folder', () => {
    const onRemove = vi.fn()
    renderTree(onRemove)
    fireEvent.click(screen.getByText('删除'))
    fireEvent.click(screen.getByText('整个工作文件夹'))
    expect(screen.getByText('/tmp/work/task-a')).toBeTruthy()
    expect(screen.getByText(/无法撤销/)).toBeTruthy()
    fireEvent.click(screen.getByText('确认删除'))
    expect(onRemove).toHaveBeenCalledWith('inst-1', 'folder')
  })
})
