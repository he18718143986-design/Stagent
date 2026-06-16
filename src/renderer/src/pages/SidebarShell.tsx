/* ------------------------------------------------------------------ */
/*  SidebarShell — 可拖拽宽度 + 可折叠为图标栏的左栏外壳                 */
/* ------------------------------------------------------------------ */

import React from 'react'
import { useSidebarLayout } from './useSidebarLayout'

export default function SidebarShell({
  children,
  taskCount = 0,
  onNewTask,
}: {
  children: React.ReactNode
  taskCount?: number
  onNewTask?: () => void
}): React.JSX.Element {
  const layout = useSidebarLayout()

  if (layout.collapsed) {
    return (
      <div
        className="relative shrink-0 flex flex-col items-center border-r border-white/10 bg-stagent-ink min-h-0 py-2 gap-1"
        style={{ width: layout.outerWidth }}
      >
        <button
          type="button"
          className="w-9 h-9 flex items-center justify-center rounded-md text-slate-300 hover:bg-white/10 hover:text-slate-100"
          title="展开任务侧栏"
          aria-label="展开任务侧栏"
          onClick={layout.expand}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18" />
            <path d="M14 9l3 3-3 3" />
          </svg>
        </button>
        {onNewTask && (
          <button
            type="button"
            className="w-9 h-9 flex items-center justify-center rounded-md text-stagent-accent hover:bg-white/10"
            title="新建任务"
            aria-label="新建任务"
            onClick={onNewTask}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
        {taskCount > 0 && (
          <div
            className="mt-1 flex flex-col items-center gap-0.5"
            title={`${taskCount} 个任务`}
          >
            <span className="text-[10px] font-medium text-slate-400 tabular-nums">{taskCount}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-stagent-accent" />
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className="relative shrink-0 flex min-h-0 border-r border-white/10 bg-stagent-ink"
      style={{ width: layout.outerWidth }}
    >
      <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden">{children}</div>

      <button
        type="button"
        className="absolute top-2 right-1 z-10 w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-slate-200"
        title="收起侧栏"
        aria-label="收起侧栏"
        onClick={layout.toggleCollapsed}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      {/* 拖拽分隔条：240–480px，宽度存 localStorage */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={layout.width}
        aria-valuemin={240}
        aria-valuemax={480}
        className={`absolute top-0 right-0 w-1 h-full cursor-col-resize z-20 ${
          layout.isResizing ? 'bg-blue-400' : 'hover:bg-blue-300/60 bg-transparent'
        }`}
        title="拖拽调整侧栏宽度"
        onMouseDown={layout.onResizePointerDown}
      />
    </div>
  )
}
