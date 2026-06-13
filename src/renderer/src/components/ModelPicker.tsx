/* ------------------------------------------------------------------ */
/*  src/renderer/src/components/ModelPicker.tsx                        */
/*  M11: Dropdown for switching the AI model for the active site.      */
/*  Switching a model = starting a new conversation thread.            */
/* ------------------------------------------------------------------ */

import { useState, useRef, useEffect } from 'react'
import type { ModelOption, SiteWithStatus } from '../../../preload/index.d'

interface ModelPickerProps {
  site: SiteWithStatus | null
  isGenerating: boolean
  onModelSwitch: (modelLabel: string) => void
}

export default function ModelPicker({ site, isGenerating, onModelSwitch }: ModelPickerProps): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [isChangingModel, setIsChangingModel] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Hooks must always run unconditionally (Rules of Hooks).
  // The early-return guard is BELOW all hook calls.
  useEffect(() => {
    if (!open) return
    const handleOutsideClick = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [open])

  // Returns null if the site doesn't support model switching
  if (!site || !site.availableModels?.length || !site.modelSwitcherSelector) {
    return null
  }

  const models: ModelOption[] = site.availableModels
  const activeModelId = site.activeModel ?? models[0]?.id
  const activeModel = models.find((m) => m.id === activeModelId) ?? models[0]
  const isDisabled = isGenerating || isChangingModel

  const handleSelect = async (model: ModelOption): Promise<void> => {
    if (isDisabled || model.id === activeModelId) {
      setOpen(false)
      return
    }
    setOpen(false)
    setIsChangingModel(true)
    try {
      const result = await window.autoAI.chat.switchModel(site.siteId, model.id)
      if (result.ok && result.modelLabel) {
        onModelSwitch(result.modelLabel)
      }
      // On error, silently reset — don't interrupt the user flow
    } finally {
      setIsChangingModel(false)
    }
  }

  return (
    <div className="flex flex-col gap-0.5" ref={containerRef}>
      {/* Dropdown trigger button */}
      <div className="relative">
        <button
          type="button"
          disabled={isDisabled}
          onClick={() => setOpen((prev) => !prev)}
          className={[
            'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium',
            'border border-white/10 bg-white/5 text-gray-300',
            'hover:bg-white/10 hover:text-white transition-colors',
            isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
          ].join(' ')}
          title="Switch model"
        >
          <span className="max-w-[120px] truncate">
            {isChangingModel ? '切换中…' : (activeModel?.label ?? '选择模型')}
          </span>
          <svg
            className={`h-3 w-3 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M2 4l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Dropdown list */}
        {open && (
          <div
            className={[
              'absolute bottom-full left-0 mb-1 z-50',
              'min-w-[160px] rounded-md border border-white/10',
              'bg-[#1e1e2e] shadow-xl',
              'overflow-hidden',
            ].join(' ')}
            role="listbox"
            aria-label="可用模型"
          >
            {models.map((model) => {
              const isActive = model.id === activeModelId
              return (
                <button
                  key={model.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => handleSelect(model)}
                  className={[
                    'flex w-full items-center gap-2 px-3 py-2 text-xs',
                    'hover:bg-white/10 transition-colors text-left',
                    isActive ? 'text-blue-400 font-semibold' : 'text-gray-300',
                  ].join(' ')}
                >
                  <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${isActive ? 'bg-blue-400' : 'bg-transparent'}`} />
                  {model.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Fixed hint below picker */}
      <p className="text-[10px] leading-tight text-gray-600 select-none">
        切换模型将开始新对话，仅显示本会话消息。
      </p>
    </div>
  )
}
