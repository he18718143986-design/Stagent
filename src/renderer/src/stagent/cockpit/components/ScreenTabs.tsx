import React from 'react'

export interface ScreenTab {
  id: string
  label: string
}

/** 屏内 Tab 切换(非路由),用于交付屏验收/复盘/成果分区。 */
export function ScreenTabs({
  tabs,
  active,
  onChange,
  className = '',
}: {
  tabs: ScreenTab[]
  active: string
  onChange: (id: string) => void
  className?: string
}): React.JSX.Element {
  return (
    <div className={`flex gap-1 p-1 rounded-xl bg-white/5 border border-white/10 ${className}`} role="tablist">
      {tabs.map((t) => {
        const selected = t.id === active
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`flex-1 text-sm py-2 px-3 rounded-lg transition-colors ${
              selected
                ? 'bg-stagent-orange text-white font-medium shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
