import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'

/** 新键:渐进式披露的全局「技术细节」开关。 */
const SHOW_TECHNICAL_KEY = 'stagent.showTechnical'
/** 旧键:双模式 uiMode（'simple' | 'pro'),仅用于一次性迁移。 */
const LEGACY_UI_MODE_KEY = 'stagent.uiMode'

interface CockpitContextValue {
  /** 全局技术细节开关:true 时默认展开专业图表/明细、显示侧栏。 */
  showTechnical: boolean
  setShowTechnical: (v: boolean) => void
  toggleShowTechnical: () => void
}

const CockpitContext = createContext<CockpitContextValue | null>(null)

/**
 * 读取持久化的技术细节开关;新键缺失时从旧 uiMode 迁移:
 * 旧值 'pro' ⇒ true,其余 ⇒ false。
 */
function readStoredShowTechnical(): boolean {
  try {
    const v = localStorage.getItem(SHOW_TECHNICAL_KEY)
    if (v === 'true') {
      return true
    }
    if (v === 'false') {
      return false
    }
    return localStorage.getItem(LEGACY_UI_MODE_KEY) === 'pro'
  } catch {
    return false
  }
}

export function CockpitProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [showTechnical, setShowTechnicalState] = useState<boolean>(readStoredShowTechnical)

  const setShowTechnical = useCallback((v: boolean) => {
    setShowTechnicalState(v)
    try {
      localStorage.setItem(SHOW_TECHNICAL_KEY, v ? 'true' : 'false')
    } catch {
      /* ignore */
    }
  }, [])

  const toggleShowTechnical = useCallback(() => {
    setShowTechnicalState((v) => {
      const next = !v
      try {
        localStorage.setItem(SHOW_TECHNICAL_KEY, next ? 'true' : 'false')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const value = useMemo<CockpitContextValue>(
    () => ({ showTechnical, setShowTechnical, toggleShowTechnical }),
    [showTechnical, setShowTechnical, toggleShowTechnical],
  )

  return <CockpitContext.Provider value={value}>{children}</CockpitContext.Provider>
}

export function useCockpitContext(): CockpitContextValue {
  const ctx = useContext(CockpitContext)
  if (!ctx) {
    throw new Error('useCockpitContext must be used within CockpitProvider')
  }
  return ctx
}

/**
 * 不抛错的可选读取:当组件可能在 CockpitProvider 之外渲染(例如单测直接挂载某屏)
 * 时使用,返回 null 由调用方决定回退值。
 */
export function useCockpitContextOptional(): CockpitContextValue | null {
  return useContext(CockpitContext)
}
