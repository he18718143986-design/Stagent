import React, { useState } from 'react'
import type { TaskListItem } from '@stagent/core'
import { useCockpitContext } from '../CockpitContext'

export function CockpitHeader({
  tasks,
  onNewTask,
  onSelectTask,
  onResume,
}: {
  tasks: TaskListItem[]
  onNewTask: () => void
  onSelectTask: (key: string) => void
  onResume: (key: string) => void
}): React.JSX.Element {
  const { showTechnical, toggleShowTechnical } = useCockpitContext()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="flex items-center justify-between px-4 py-2 border-b border-stone-200/60 bg-white/60 backdrop-blur-sm shrink-0">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-stone-800">Stagent</span>
        {!showTechnical && (
          <>
            <button
              type="button"
              className="text-xs px-2 py-1 rounded-full border border-stone-200 text-stone-600 hover:bg-stone-50"
              onClick={onNewTask}
            >
              新建
            </button>
            <div className="relative">
              <button
                type="button"
                className="text-xs px-2 py-1 rounded-full border border-stone-200 text-stone-600 hover:bg-stone-50"
                onClick={() => setMenuOpen((v) => !v)}
              >
                历史任务 {tasks.length > 0 ? `(${tasks.length})` : ''}
              </button>
              {menuOpen && tasks.length > 0 && (
                <div className="absolute top-full left-0 mt-1 w-64 max-h-48 overflow-y-auto bg-white border border-stone-200 rounded-lg shadow-lg z-20">
                  {tasks.map((t) => (
                    <button
                      key={t.instanceKey}
                      type="button"
                      className="w-full text-left px-3 py-2 text-xs hover:bg-orange-50 border-b border-stone-50 last:border-0"
                      onClick={() => {
                        if (t.status === 'idle' || t.status === 'failed') {
                          onResume(t.instanceKey)
                        } else {
                          onSelectTask(t.instanceKey)
                        }
                        setMenuOpen(false)
                      }}
                    >
                      <div className="font-medium text-stone-800 truncate">{t.title || t.instanceKey.slice(0, 8)}</div>
                      <div className="text-stone-400">{t.status}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          role="switch"
          aria-checked={showTechnical}
          aria-label="技术细节"
          className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-stagent-orange shrink-0"
          onClick={toggleShowTechnical}
        >
          <span className="whitespace-nowrap">技术细节</span>
          <span
            className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
              showTechnical ? 'bg-stagent-orange' : 'bg-stone-300'
            }`}
          >
            <span
              className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                showTechnical ? 'translate-x-3.5' : 'translate-x-0.5'
              }`}
            />
          </span>
        </button>
      </div>
    </header>
  )
}
