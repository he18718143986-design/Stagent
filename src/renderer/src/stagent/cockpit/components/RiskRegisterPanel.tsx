import React from 'react'
import { humanizeJargon } from '../plainLanguage'

/** 计划屏常驻「风险登记」:汇总黄灯警告与红灯阻断,比折叠区更显眼。 */
export function RiskRegisterPanel({
  warnings,
  blockReasons,
  blocked,
}: {
  warnings: string[]
  blockReasons: string[]
  blocked: boolean
}): React.JSX.Element {
  const total = warnings.length + blockReasons.length
  const clear = total === 0

  return (
    <div
      className={`rounded-xl border p-4 mb-4 ${
        blocked
          ? 'border-red-500/35 bg-red-500/10'
          : clear
            ? 'border-green-500/25 bg-green-500/5'
            : 'border-amber-500/30 bg-amber-500/10'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-sm font-semibold text-slate-100">风险登记</h2>
        <span
          className={`text-[11px] px-2 py-0.5 rounded-full tabular-nums ${
            blocked
              ? 'bg-red-500/20 text-red-300'
              : clear
                ? 'bg-green-500/15 text-green-300'
                : 'bg-amber-500/20 text-amber-300'
          }`}
        >
          {clear ? '0 项' : `${total} 项`}
        </span>
      </div>

      {clear ? (
        <p className="text-sm text-green-300/90">未发现需登记的风险项,可以按计划推进。</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {blockReasons.map((r, i) => (
            <li key={`b-${i}`} className="flex items-start gap-2 text-red-300">
              <span className="shrink-0" aria-hidden="true">
                🔴
              </span>
              <span>
                <span className="font-medium">阻断 · </span>
                {humanizeJargon(r)}
              </span>
            </li>
          ))}
          {warnings.map((w, i) => (
            <li key={`w-${i}`} className="flex items-start gap-2 text-amber-300">
              <span className="shrink-0" aria-hidden="true">
                🟡
              </span>
              <span>
                <span className="font-medium">待确认 · </span>
                {humanizeJargon(w)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {blocked && blockReasons.length > 0 && (
        <p className="text-xs text-red-300/90 mt-2">存在阻断项时无法开始执行,请先处理或修改计划。</p>
      )}
    </div>
  )
}
