/* ------------------------------------------------------------------ */
/*  useSidebarLayout — 左栏宽度 / 折叠状态，持久化到 localStorage       */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useRef, useState } from 'react'

export const SIDEBAR_WIDTH_MIN = 240
export const SIDEBAR_WIDTH_MAX = 480
export const SIDEBAR_WIDTH_DEFAULT = 288
export const SIDEBAR_COLLAPSED_WIDTH = 48

/** 将宽度限制在 240–480px（供测试与读取 localStorage 复用）。 */
export function clampSidebarWidth(n: number): number {
  if (!Number.isFinite(n)) {
    return SIDEBAR_WIDTH_DEFAULT
  }
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(n)))
}

const STORAGE_WIDTH = 'stagent.sidebar.width'
const STORAGE_COLLAPSED = 'stagent.sidebar.collapsed'

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_WIDTH)
    if (raw == null) {
      return SIDEBAR_WIDTH_DEFAULT
    }
    const n = Number(raw)
    if (!Number.isFinite(n)) {
      return SIDEBAR_WIDTH_DEFAULT
    }
    return clampSidebarWidth(n)
  } catch {
    return SIDEBAR_WIDTH_DEFAULT
  }
}

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_COLLAPSED) === '1'
  } catch {
    return false
  }
}

export interface SidebarLayout {
  width: number
  collapsed: boolean
  /** 展开时的可视宽度（折叠时为 SIDEBAR_COLLAPSED_WIDTH）。 */
  outerWidth: number
  toggleCollapsed: () => void
  expand: () => void
  /** 绑定到分隔条 onMouseDown。 */
  onResizePointerDown: (e: React.MouseEvent) => void
  isResizing: boolean
}

export function useSidebarLayout(): SidebarLayout {
  const [width, setWidth] = useState(readStoredWidth)
  const [collapsed, setCollapsed] = useState(readStoredCollapsed)
  const [isResizing, setIsResizing] = useState(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_WIDTH, String(width))
    } catch {
      /* ignore */
    }
  }, [width])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_COLLAPSED, collapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [collapsed])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => !v)
  }, [])

  const expand = useCallback(() => {
    setCollapsed(false)
  }, [])

  const onResizePointerDown = useCallback(
    (e: React.MouseEvent) => {
      if (collapsed) {
        return
      }
      e.preventDefault()
      dragRef.current = { startX: e.clientX, startWidth: width }
      setIsResizing(true)
    },
    [collapsed, width],
  )

  useEffect(() => {
    if (!isResizing) {
      return
    }
    const onMove = (e: MouseEvent): void => {
      const drag = dragRef.current
      if (!drag) {
        return
      }
      const next = drag.startWidth + (e.clientX - drag.startX)
      setWidth(clampSidebarWidth(next))
    }
    const onUp = (): void => {
      dragRef.current = null
      setIsResizing(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isResizing])

  useEffect(() => {
    if (!isResizing) {
      return
    }
    const prev = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.userSelect = prev
    }
  }, [isResizing])

  return {
    width,
    collapsed,
    outerWidth: collapsed ? SIDEBAR_COLLAPSED_WIDTH : width,
    toggleCollapsed,
    expand,
    onResizePointerDown,
    isResizing,
  }
}
