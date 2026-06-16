/* ------------------------------------------------------------------ */
/*  TaskTree — 统一左栏树：任务=顶层节点，选中任务就地展开其文件树        */
/*                                                                     */
/*  顶层每个任务一行（标题 + 完成/总阶段·状态 + 悬停 恢复/删除）。        */
/*  仅「选中」的任务展开，内嵌 FileTree(rootPath=该任务 taskWorkspacePath)。 */
/* ------------------------------------------------------------------ */

import React, { useMemo, useState } from 'react'
import type { DeleteScope, TaskListItem } from '@stagent/core'
import FileTree, { type FsNode } from './FileTree'

function formatTaskTime(createdAt: string): string {
  if (!createdAt) {
    return ''
  }
  const d = new Date(createdAt)
  if (Number.isNaN(d.getTime())) {
    return createdAt.slice(0, 10)
  }
  return d.toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** 实例状态 → 中文标签（idle = 确认页草稿、尚未执行）。 */
function statusLabel(status: string): string {
  switch (status) {
    case 'idle':
      return '草稿'
    case 'running':
      return '进行中'
    case 'paused':
      return '暂停'
    case 'completed':
      return '已完成'
    case 'error':
      return '失败'
    default:
      return status
  }
}

function resumeLabel(status: string): string {
  switch (status) {
    case 'idle':
      return '继续确认'
    case 'running':
      return '继续执行'
    case 'error':
      return '继续处理'
    default:
      return '恢复'
  }
}

export default function TaskTree({
  tasks,
  selectedTaskKey,
  selectedFilePath,
  newPaths,
  refreshNonce,
  onSelectTask,
  onSelectFile,
  onNewTask,
  onResume,
  onRemove,
}: {
  tasks: TaskListItem[]
  selectedTaskKey: string | null
  selectedFilePath: string | null
  newPaths?: Set<string>
  refreshNonce?: number
  onSelectTask: (instanceKey: string) => void
  onSelectFile: (node: FsNode) => void
  onNewTask: () => void
  onResume: (instanceKey: string) => void
  onRemove: (instanceKey: string, scope: DeleteScope) => void
}): React.JSX.Element {
  const [pendingDelete, setPendingDelete] = useState<TaskListItem | null>(null)
  const [scope, setScope] = useState<DeleteScope>('record')

  const workspaceDuplicateCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of tasks) {
      const ws = t.taskWorkspacePath
      if (ws) {
        counts.set(ws, (counts.get(ws) ?? 0) + 1)
      }
    }
    return counts
  }, [tasks])

  function closeDelete(): void {
    setPendingDelete(null)
    setScope('record')
  }
  function confirmDelete(): void {
    if (pendingDelete) {
      onRemove(pendingDelete.instanceKey, scope)
    }
    closeDelete()
  }

  return (
    <div className="flex flex-col h-full min-h-0 w-full">
      <div className="p-3 pr-8 flex items-center justify-between shrink-0">
        <span className="text-sm font-semibold text-slate-200">任务</span>
        <button
          className="text-xs bg-stagent-accent text-white px-2 py-1 rounded hover:brightness-110"
          onClick={onNewTask}
        >
          + 新建
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-1 pb-2">
        {tasks.length === 0 && <div className="text-xs text-slate-500 px-3 py-3">暂无任务</div>}
        {tasks.map((t) => {
          const expanded = t.instanceKey === selectedTaskKey
          const wsDup = t.taskWorkspacePath ? (workspaceDuplicateCounts.get(t.taskWorkspacePath) ?? 0) > 1 : false
          return (
            <div key={t.instanceKey} className="mb-0.5">
              <div
                className={`group flex items-center gap-1 px-2 py-1 rounded cursor-pointer ${
                  expanded ? 'bg-stagent-accent/15' : 'hover:bg-white/5'
                }`}
                style={{ paddingLeft: '6px' }}
                title={t.taskWorkspacePath ?? t.title}
                onClick={() => onSelectTask(t.instanceKey)}
              >
                <span className="inline-block w-4 text-slate-500">{expanded ? '▾' : '▸'}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-200 truncate">{t.title}</div>
                  <div className="text-[11px] text-slate-500">
                    {t.completedStages}/{t.stageCount} · {statusLabel(t.status)}
                    {wsDup && t.createdAt ? ` · ${formatTaskTime(t.createdAt)}` : ''}
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  {t.recoverable && (
                    <button
                      className="text-[11px] text-blue-400 hover:underline"
                      onClick={(e) => {
                        e.stopPropagation()
                        onResume(t.instanceKey)
                      }}
                    >
                      {resumeLabel(t.status)}
                    </button>
                  )}
                  <button
                    className="text-[11px] text-red-400 hover:underline"
                    onClick={(e) => {
                      e.stopPropagation()
                      setScope('record')
                      setPendingDelete(t)
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>

              {expanded &&
                (t.taskWorkspacePath ? (
                  <FileTree
                    rootPath={t.taskWorkspacePath}
                    selectedPath={selectedFilePath}
                    newPaths={newPaths}
                    refreshNonce={refreshNonce}
                    baseDepth={0}
                    onSelectFile={onSelectFile}
                  />
                ) : (
                  <div className="px-2 py-1 text-xs text-slate-500" style={{ paddingLeft: '24px' }}>
                    无工作目录
                  </div>
                ))}
            </div>
          )
        })}
      </div>

      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={closeDelete}
        >
          <div
            className="w-[420px] max-w-[90vw] rounded-lg bg-stagent-surface border border-white/10 p-5 shadow-xl text-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-base font-semibold text-slate-100">删除任务</div>
            <div className="mt-1 text-sm text-slate-400 truncate" title={pendingDelete.title}>
              {pendingDelete.title}
            </div>

            <div className="mt-4 space-y-2">
              <label className="flex items-start gap-2 text-sm text-slate-200">
                <input
                  type="radio"
                  name="del-scope"
                  className="mt-0.5"
                  checked={scope === 'record'}
                  onChange={() => setScope('record')}
                />
                <span>
                  <span className="font-medium">仅任务记录</span>
                  <span className="block text-xs text-slate-500">
                    清除侧栏记录与 .stagent 状态目录，保留所有产物文件。
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-slate-200">
                <input
                  type="radio"
                  name="del-scope"
                  className="mt-0.5"
                  checked={scope === 'artifacts'}
                  onChange={() => setScope('artifacts')}
                />
                <span>
                  <span className="font-medium">连同任务新建的产物</span>
                  <span className="block text-xs text-slate-500">
                    额外删除本任务生成的文件与需求分析文档/工作流规划，不动你原有或手改的文件。
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-slate-200">
                <input
                  type="radio"
                  name="del-scope"
                  className="mt-0.5"
                  checked={scope === 'folder'}
                  onChange={() => setScope('folder')}
                />
                <span>
                  <span className="font-medium text-red-300">整个工作文件夹</span>
                  <span className="block text-xs text-slate-500">
                    递归删除下面整个目录（含无关文件，不可恢复）：
                  </span>
                  <span className="block text-xs text-red-400 break-all">
                    {pendingDelete.taskWorkspacePath ?? '（无工作目录，无法整删）'}
                  </span>
                </span>
              </label>
            </div>

            {scope === 'folder' && (
              <div className="mt-3 rounded bg-red-500/10 px-3 py-2 text-xs text-red-300">
                警告：此操作将永久删除整个工作文件夹及其全部内容，无法撤销。
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10"
                onClick={closeDelete}
              >
                取消
              </button>
              <button
                className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
                disabled={scope === 'folder' && !pendingDelete.taskWorkspacePath}
                onClick={confirmDelete}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
