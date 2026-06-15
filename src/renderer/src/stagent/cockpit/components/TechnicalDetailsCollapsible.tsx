import React, { useEffect, useRef, useState } from 'react'
import { useCockpitContextOptional } from '../CockpitContext'

export function TechnicalDetailsCollapsible({
  title = '技术细节（给开发者看）',
  children,
  defaultOpen,
}: {
  title?: string
  children: React.ReactNode
  /**
   * 显式初始展开态。省略时跟随全局「技术细节」开关（showTechnical）：
   * 开关打开则默认展开，关闭则默认收起。用户手动点击后以本地状态为准。
   */
  defaultOpen?: boolean
}): React.JSX.Element {
  const ctx = useCockpitContextOptional()
  const density = ctx?.showTechnical ?? false
  const initial = defaultOpen ?? density
  const [open, setOpen] = useState(initial)
  const userTouched = useRef(false)

  // 未显式指定 defaultOpen 且用户未手动切换时，跟随全局开关变化。
  useEffect(() => {
    if (defaultOpen === undefined && !userTouched.current) {
      setOpen(density)
    }
  }, [density, defaultOpen])

  const toggle = (): void => {
    userTouched.current = true
    setOpen((v) => !v)
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        aria-expanded={open}
        className="w-full text-left text-sm text-stone-500 bg-stone-100/80 hover:bg-stone-100 rounded-lg px-4 py-2.5 flex items-center gap-2"
        onClick={toggle}
      >
        <span className="text-xs">{open ? '▼' : '▶'}</span>
        {title}
      </button>
      {open && <div className="mt-2 text-xs text-stone-600 space-y-1 px-1">{children}</div>}
    </div>
  )
}
