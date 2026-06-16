/* ------------------------------------------------------------------ */
/*  src/renderer/src/components/TabBar.tsx — Site tab bar             */
/*                                                                     */
/*  Rendered in App.tsx when the user is on the /chat page.           */
/*  Only shows sites whose status === 'connected'.                     */
/* ------------------------------------------------------------------ */

import React from 'react'
import type { SiteWithStatus } from '../../../preload/index.d'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Disambiguates identical labels by appending " 2", " 3"… */
function buildLabels(sites: SiteWithStatus[]): Map<string, string> {
  const counts = new Map<string, number>()
  for (const s of sites) counts.set(s.label, (counts.get(s.label) ?? 0) + 1)
  const seen = new Map<string, number>()
  const result = new Map<string, string>()
  for (const s of sites) {
    if ((counts.get(s.label) ?? 1) > 1) {
      const n = (seen.get(s.label) ?? 0) + 1
      seen.set(s.label, n)
      result.set(s.siteId, n === 1 ? s.label : `${s.label} ${n}`)
    } else {
      result.set(s.siteId, s.label)
    }
  }
  return result
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface TabBarProps {
  /** Full site list; tab bar filters to status === 'connected'. */
  sites: SiteWithStatus[]
  activeSiteId: string | null
  onActiveSiteIdChange: (siteId: string) => void
  /** Called when user clicks the [+] button. */
  onAddSite: () => void
  /** Called when user clicks [×] on a tab; should call site:remove + refresh. */
  onRemoveSite: (siteId: string) => Promise<void>
  /** Called when user clicks the ⚙ settings button. */
  onSettings: () => Promise<void>
  /** Called when user clicks the 工作流 (Stagent) button. */
  onOpenStagent?: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TabBar({
  sites,
  activeSiteId,
  onActiveSiteIdChange,
  onAddSite,
  onRemoveSite,
  onSettings,
  onOpenStagent,
}: TabBarProps): React.JSX.Element {
  const connected = sites.filter((s) => s.status === 'connected')
  const labels = buildLabels(connected)

  return (
    // Full row is a drag region; all interactive elements carry no-drag
    <div className="drag-region h-10 flex items-center shrink-0 bg-stagent-surface border-b border-white/10 select-none">
      {/* Traffic-light spacer — matches trafficLightPosition: { x:16, y:16 } */}
      <div className="w-20 shrink-0" />

      {/* Site tabs — scrollable if many sites */}
      <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto">
        {connected.map((s) => {
          const isActive = s.siteId === activeSiteId
          return (
            <div
              key={s.siteId}
              className={`no-drag flex items-center gap-1 px-2.5 h-7 rounded-md text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                isActive ? 'bg-gray-900 text-white' : 'text-slate-300 hover:bg-white/10'
              }`}
              onClick={() => onActiveSiteIdChange(s.siteId)}
            >
              <span>{labels.get(s.siteId) ?? s.label}</span>
              <button
                className={`no-drag flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] leading-none transition-colors ${
                  isActive
                    ? 'text-white/60 hover:bg-white/20 hover:text-white'
                    : 'text-slate-500 hover:bg-white/10 hover:text-slate-200'
                }`}
                aria-label={`关闭 ${s.label}`}
                onClick={async (e) => {
                  e.stopPropagation()
                  await onRemoveSite(s.siteId)
                }}
              >
                ×
              </button>
            </div>
          )
        })}

        {/* Add-site button */}
        <button
          className="no-drag flex items-center justify-center w-6 h-6 rounded-md text-slate-500 hover:bg-white/10 hover:text-slate-300 transition-colors shrink-0 text-base leading-none ml-0.5"
          onClick={onAddSite}
          aria-label="添加 AI"
        >
          +
        </button>
      </div>

      {/* Stagent (工作流) button */}
      {onOpenStagent && (
        <button
          className="no-drag flex items-center justify-center h-7 px-2 rounded-md mr-1 text-xs font-medium text-slate-400 hover:bg-white/10 hover:text-slate-200 transition-colors shrink-0"
          onClick={onOpenStagent}
          title="决策式工作流"
        >
          工作流
        </button>
      )}

      {/* Settings button */}
      <button
        className="no-drag flex items-center justify-center w-7 h-7 rounded-md mr-3 text-slate-500 hover:bg-white/10 hover:text-slate-300 transition-colors shrink-0"
        onClick={onSettings}
        title="AI 资源设置"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M7 1v1.4M7 11.6V13M1 7h1.4M11.6 7H13M2.929 2.929l.99.99M10.081 10.081l.99.99M10.081 3.919l-.99.99M3.919 10.081l-.99.99"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  )
}
