import React from 'react'
import type { StageConfidence } from '../../useStagentEngine'
import { deriveCredibility, type ConfidenceLevel } from '../derive/credibility'

const LEVEL_META: Record<ConfidenceLevel, { label: string; dot: string; text: string }> = {
  high: { label: '高', dot: 'bg-stagent-success', text: 'text-stagent-success' },
  medium: { label: '中', dot: 'bg-amber-500', text: 'text-amber-600' },
  low: { label: '偏低', dot: 'bg-orange-500', text: 'text-orange-600' },
  critical: { label: '严重偏低', dot: 'bg-red-500', text: 'text-red-600' },
}

const LEVEL_ORDER: ConfidenceLevel[] = ['high', 'medium', 'low', 'critical']

/**
 * 常驻"可信度带":汇总逐阶段置信度。无数据时显示中性占位,
 * 避免在执行前误导。纯展示组件,聚合逻辑在 deriveCredibility(已单测)。
 */
export function CredibilityStrip({
  confidence,
  className = '',
}: {
  confidence: Record<string, StageConfidence>
  className?: string
}): React.JSX.Element {
  const info = deriveCredibility(confidence)

  if (info.state === 'empty') {
    return (
      <div
        className={`flex items-center gap-2 rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs text-stone-400 ${className}`}
        aria-label="可信度:尚无数据"
      >
        <span className="w-2 h-2 rounded-full bg-stone-300" />
        <span>可信度 · 尚无数据</span>
      </div>
    )
  }

  const meta = LEVEL_META[info.overallLevel ?? 'medium']

  return (
    <div
      className={`flex items-center gap-3 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs ${className}`}
      aria-label={`可信度 ${meta.label},均值 ${info.averagePercent}%`}
      title={info.lowestReasons.join('；')}
    >
      <span className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
        <span className={`font-medium ${meta.text}`}>可信度 {meta.label}</span>
      </span>
      <span className="text-stone-500 tabular-nums">均值 {info.averagePercent}%</span>
      <span className="flex items-center gap-1.5 text-stone-400">
        {LEVEL_ORDER.filter((lvl) => info.counts[lvl] > 0).map((lvl) => (
          <span key={lvl} className="flex items-center gap-0.5">
            <span className={`w-1.5 h-1.5 rounded-full ${LEVEL_META[lvl].dot}`} />
            <span className="tabular-nums">{info.counts[lvl]}</span>
          </span>
        ))}
      </span>
    </div>
  )
}
