/* ------------------------------------------------------------------ */
/*  src/renderer/src/components/ToolToggles.tsx                        */
/*  M12: One-click on/off chips for composer tools (深度思考 / 联网搜索). */
/*  Mirrors ModelPicker — hidden when the site has no tool toggles.    */
/* ------------------------------------------------------------------ */

import { useState } from 'react'
import type { SiteWithStatus } from '../../../preload/index.d'

interface ToolTogglesProps {
  site: SiteWithStatus | null
  isGenerating: boolean
  /** Called after a successful toggle so the parent can refresh site state. */
  onToggled: () => void
}

export default function ToolToggles({ site, isGenerating, onToggled }: ToolTogglesProps): JSX.Element | null {
  const [pendingId, setPendingId] = useState<string | null>(null)

  if (!site || !site.toolToggles?.length) {
    return null
  }

  const active = new Set(site.activeTools ?? [])
  const tools = site.toolToggles

  const handleClick = async (toolId: string): Promise<void> => {
    if (isGenerating || pendingId) return
    const enable = !active.has(toolId)
    setPendingId(toolId)
    try {
      const result = await window.autoAI.chat.toggleTool(site.siteId, toolId, enable)
      if (result.ok) onToggled()
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="一键工具">
      {tools.map((tool) => {
        const isOn = active.has(tool.id)
        const isPending = pendingId === tool.id
        const disabled = isGenerating || (pendingId !== null && !isPending)
        return (
          <button
            key={tool.id}
            type="button"
            aria-pressed={isOn}
            disabled={disabled}
            onClick={() => handleClick(tool.id)}
            title={isOn ? `关闭「${tool.label}」` : `开启「${tool.label}」`}
            className={[
              'rounded-full px-2.5 py-1 text-xs font-medium border transition-colors',
              isOn
                ? 'border-blue-400/60 bg-blue-500/15 text-blue-300'
                : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200',
              disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
            ].join(' ')}
          >
            {isPending ? '…' : (isOn ? '● ' : '○ ')}
            {tool.label}
          </button>
        )
      })}
    </div>
  )
}
