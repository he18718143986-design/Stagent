import React, { useState } from 'react'

export function TechnicalDetailsCollapsible({
  title = '技术细节（给开发者看）',
  children,
  defaultOpen = false,
}: {
  title?: string
  children: React.ReactNode
  defaultOpen?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mt-4">
      <button
        type="button"
        className="w-full text-left text-sm text-stone-500 bg-stone-100/80 hover:bg-stone-100 rounded-lg px-4 py-2.5 flex items-center gap-2"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-xs">{open ? '▼' : '▶'}</span>
        {title}
      </button>
      {open && <div className="mt-2 text-xs text-stone-600 space-y-1 px-1">{children}</div>}
    </div>
  )
}
