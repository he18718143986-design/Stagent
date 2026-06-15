import React from 'react'
import type { StageStatus } from '@stagent/core'
import { deriveMiniDag, type DagStageInput, type StageRole } from '../derive/dag'

const ROLE_META: Record<StageRole, { label: string; cls: string }> = {
  decision: { label: '决策', cls: 'border-purple-300 bg-purple-50 text-purple-700' },
  impl: { label: '实现', cls: 'border-blue-300 bg-blue-50 text-blue-700' },
  test: { label: '测试', cls: 'border-green-300 bg-green-50 text-green-700' },
  integration: { label: '集成', cls: 'border-orange-300 bg-orange-50 text-orange-700' },
  other: { label: '', cls: 'border-stone-200 bg-stone-50 text-stone-600' },
}

function statusDecoration(status: StageStatus): { ring: string; opacity: string; mark: string } {
  switch (status) {
    case 'done':
    case 'skipped':
      return { ring: '', opacity: 'opacity-100', mark: '✓' }
    case 'running':
    case 'retrying':
      return { ring: 'ring-2 ring-blue-300', opacity: 'opacity-100', mark: '⟳' }
    case 'waiting-questions':
    case 'paused':
      return { ring: 'ring-2 ring-amber-300', opacity: 'opacity-100', mark: '⏸' }
    case 'error':
      return { ring: 'ring-2 ring-red-300', opacity: 'opacity-100', mark: '✗' }
    default:
      return { ring: '', opacity: 'opacity-50', mark: '' }
  }
}

/**
 * 紧凑结构 DAG 概览（纯 CSS 横向流,无第三方图库）。
 * 节点派生在 deriveMiniDag(已单测),本组件仅负责呈现。
 */
export function MiniDag({
  stages,
  stageStatus,
}: {
  stages: DagStageInput[]
  stageStatus: Record<string, StageStatus>
}): React.JSX.Element {
  const nodes = deriveMiniDag(stages, stageStatus)

  if (nodes.length === 0) {
    return <div className="text-xs text-stone-400">暂无阶段</div>
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto py-1" aria-label="结构概览">
      {nodes.map((n, i) => {
        const role = ROLE_META[n.role]
        const deco = statusDecoration(n.status)
        return (
          <React.Fragment key={n.id}>
            {i > 0 && <span className="shrink-0 w-3 h-px bg-stone-300" aria-hidden="true" />}
            <div
              className={`shrink-0 flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${role.cls} ${deco.ring} ${deco.opacity}`}
              title={`${i + 1}. ${n.title}${role.label ? ` · ${role.label}` : ''}`}
            >
              {deco.mark && <span className="text-[10px]">{deco.mark}</span>}
              <span className="max-w-[7rem] truncate">{n.title}</span>
              {role.label && (
                <span className="text-[9px] px-1 rounded bg-white/60">{role.label}</span>
              )}
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}
