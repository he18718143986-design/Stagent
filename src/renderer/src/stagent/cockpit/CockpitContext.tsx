import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { UiMode } from './deriveCockpitStep'

const STORAGE_KEY = 'stagent.uiMode'

interface CockpitContextValue {
  uiMode: UiMode
  setUiMode: (mode: UiMode) => void
  toggleUiMode: () => void
}

const CockpitContext = createContext<CockpitContextValue | null>(null)

function readStoredMode(): UiMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'pro' ? 'pro' : 'simple'
  } catch {
    return 'simple'
  }
}

export function CockpitProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [uiMode, setUiModeState] = useState<UiMode>(readStoredMode)

  const setUiMode = useCallback((mode: UiMode) => {
    setUiModeState(mode)
    try {
      localStorage.setItem(STORAGE_KEY, mode)
    } catch {
      /* ignore */
    }
  }, [])

  const toggleUiMode = useCallback(() => {
    setUiMode(uiMode === 'simple' ? 'pro' : 'simple')
  }, [setUiMode, uiMode])

  const value = useMemo(
    () => ({ uiMode, setUiMode, toggleUiMode }),
    [uiMode, setUiMode, toggleUiMode],
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
