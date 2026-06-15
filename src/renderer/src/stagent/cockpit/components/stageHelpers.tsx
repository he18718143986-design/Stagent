import React from 'react'
import type { StageStatus } from '@stagent/core'

export const STATUS_STYLE: Record<StageStatus, { label: string; cls: string }> = {
  pending: { label: '待执行', cls: 'bg-gray-100 text-gray-500' },
  running: { label: '执行中', cls: 'bg-blue-100 text-blue-700' },
  'waiting-questions': { label: '待回答', cls: 'bg-amber-100 text-amber-700' },
  paused: { label: '已暂停', cls: 'bg-purple-100 text-purple-700' },
  done: { label: '已完成', cls: 'bg-green-100 text-green-700' },
  skipped: { label: '已跳过', cls: 'bg-gray-100 text-gray-400' },
  error: { label: '出错', cls: 'bg-red-100 text-red-700' },
  retrying: { label: '重试中', cls: 'bg-orange-100 text-orange-700' },
}

export function StatusBadge({ status }: { status: StageStatus }): React.JSX.Element {
  const s = STATUS_STYLE[status] ?? { label: status, cls: 'bg-gray-100 text-gray-500' }
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>{s.label}</span>
}

export function simpleStageStatusLabel(status: StageStatus): { label: string; tone: 'done' | 'active' | 'pending' } {
  if (status === 'done' || status === 'skipped') {
    return { label: '完成', tone: 'done' }
  }
  if (status === 'running' || status === 'retrying' || status === 'waiting-questions' || status === 'paused') {
    return { label: '进行中', tone: 'active' }
  }
  if (status === 'error') {
    return { label: '需处理', tone: 'active' }
  }
  return { label: '待开始', tone: 'pending' }
}

export function stageRoleColor(stageId: string, isDecision?: boolean): string {
  if (isDecision) {
    return 'border-l-4 border-purple-400'
  }
  if (/^stage_impl_/.test(stageId)) {
    return 'border-l-4 border-blue-400'
  }
  if (/^stage_test_run_/.test(stageId)) {
    return 'border-l-4 border-green-400'
  }
  if (/integration|assemble|main/.test(stageId)) {
    return 'border-l-4 border-orange-400'
  }
  return 'border-l-4 border-gray-300'
}

export function isEngineInsertedStage(stageId: string): boolean {
  return (
    /venv|disk.bootstrap|delivery|smoke|verify|preflight|runtime_replan/.test(stageId) ||
    stageId.startsWith('stage_disk_')
  )
}

export function filterPlanSteps(stages: Array<{ id: string; title: string }>): Array<{ id: string; title: string }> {
  return stages.filter((s) => !isEngineInsertedStage(s.id) && !/^stage_test_run_/.test(s.id))
}
