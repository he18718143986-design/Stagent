import React from 'react'
import type { StageStatus } from '@stagent/core'

export const STATUS_STYLE: Record<StageStatus, { label: string; cls: string }> = {
  pending: { label: '待执行', cls: 'bg-white/10 text-slate-400' },
  running: { label: '执行中', cls: 'bg-blue-500/20 text-blue-300' },
  'waiting-questions': { label: '待回答', cls: 'bg-amber-500/20 text-amber-300' },
  paused: { label: '已暂停', cls: 'bg-purple-500/20 text-purple-300' },
  done: { label: '已完成', cls: 'bg-green-500/20 text-green-300' },
  skipped: { label: '已跳过', cls: 'bg-white/10 text-slate-500' },
  error: { label: '出错', cls: 'bg-red-500/20 text-red-300' },
  retrying: { label: '重试中', cls: 'bg-orange-500/20 text-orange-300' },
}

export function StatusBadge({ status }: { status: StageStatus }): React.JSX.Element {
  const s = STATUS_STYLE[status] ?? { label: status, cls: 'bg-white/10 text-slate-400' }
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
  return 'border-l-4 border-white/15'
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
