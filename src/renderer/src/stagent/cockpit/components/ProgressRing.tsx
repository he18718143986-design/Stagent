import React from 'react'

/**
 * 纯 CSS（conic-gradient）进度环,无 SVG / 无第三方依赖。
 * 用于统一执行屏的英雄进度。
 */
export function ProgressRing({
  percent,
  size = 72,
  label,
}: {
  percent: number
  size?: number
  label?: string
}): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)))
  const ringInset = Math.round(size * 0.14)

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? '进度'}
    >
      <div
        className="absolute inset-0 rounded-full"
        style={{ background: `conic-gradient(#F97316 ${clamped * 3.6}deg, #2A323D 0deg)` }}
      />
      <div className="absolute rounded-full bg-stagent-surface" style={{ inset: ringInset }} />
      <span className="relative text-sm font-semibold text-slate-100 tabular-nums">{clamped}%</span>
    </div>
  )
}
