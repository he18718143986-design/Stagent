import React from 'react'
import { simpleTheme } from '../theme'

export function ConfirmStartModal({
  open,
  title,
  summaryLines,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title?: string
  summaryLines: string[]
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element | null {
  if (!open) {
    return null
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-stone-900/40" aria-label="关闭" onClick={onCancel} />
      <div className={`relative ${simpleTheme.card} max-w-md w-full shadow-xl`}>
        <h3 className="text-lg font-bold text-slate-100 mb-2">{title ?? '确认开始制作？'}</h3>
        <p className="text-sm text-slate-300 mb-4">
          接下来会自动开发并测试，中途若有需要会问你。你可以先去忙别的。
        </p>
        <ul className="text-sm text-slate-200 space-y-1 mb-6 list-disc pl-5">
          {summaryLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className="flex flex-col gap-2">
          <button type="button" className={simpleTheme.primaryBtn} onClick={onConfirm}>
            确认，开始制作
          </button>
          <button type="button" className={`${simpleTheme.secondaryBtn} w-full text-center`} onClick={onCancel}>
            再想想
          </button>
        </div>
      </div>
    </div>
  )
}
