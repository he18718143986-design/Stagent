import React from 'react'
import type { QualityReportPayload } from '@stagent/core'
import { deriveExecutionQuality } from '../derive/executionQuality'

const TONE_CLS: Record<string, string> = {
  neutral: 'border-white/10 bg-white/5 text-slate-300',
  good: 'border-green-500/25 bg-green-500/10 text-green-300',
  warn: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
  bad: 'border-red-500/25 bg-red-500/10 text-red-300',
}

const TONE_DOT: Record<string, string> = {
  neutral: 'bg-slate-500',
  good: 'bg-green-400',
  warn: 'bg-amber-400',
  bad: 'bg-red-400',
}

/** 执行屏常驻质量条:汇总 AFK + 逐阶段测试,无报告时中性占位。 */
export function ExecutionQualityBar({
  qualityReport,
  className = '',
}: {
  qualityReport?: QualityReportPayload | null
  className?: string
}): React.JSX.Element {
  const q = deriveExecutionQuality(qualityReport)
  return (
    <div
      className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm mb-4 ${TONE_CLS[q.tone]} ${className}`}
      role="status"
      aria-label={q.label}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${TONE_DOT[q.tone]}`} aria-hidden="true" />
      <div className="min-w-0">
        <div className="font-medium">{q.label}</div>
        {q.detail && <div className="text-xs opacity-90 mt-0.5 truncate">{q.detail}</div>}
      </div>
    </div>
  )
}
