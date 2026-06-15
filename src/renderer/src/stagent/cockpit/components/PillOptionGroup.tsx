import React from 'react'
import { simpleTheme } from '../theme'

export interface PillQuestion {
  id: string
  text: string
  options?: string[]
  recommendedOption?: string
  hint?: string
}

export function PillOptionGroup({
  question,
  value,
  onChange,
  showRecommended = true,
}: {
  question: PillQuestion
  value: string
  onChange: (v: string) => void
  showRecommended?: boolean
}): React.JSX.Element {
  const recommended = question.recommendedOption ?? question.options?.[0]
  return (
    <div className="space-y-3">
      <div className="text-base font-medium text-stone-800">{question.text}</div>
      {question.options && question.options.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {question.options.map((opt) => {
            const selected = value === opt
            const isRec = showRecommended && opt === recommended
            return (
              <button
                key={opt}
                type="button"
                className={`relative px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  selected ? simpleTheme.pillSelected : simpleTheme.pillDefault
                }`}
                onClick={() => onChange(opt)}
              >
                {opt}
                {isRec && (
                  <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-stagent-orange text-white align-middle">
                    推荐
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ) : (
        <input
          className="w-full text-sm border border-stone-200 rounded-xl px-3 py-2"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {question.hint && <p className="text-xs text-stone-500">{question.hint}</p>}
    </div>
  )
}

/** 从选项列表推断推荐项（第一项或含「推荐」字样的项） */
export function inferRecommendedOption(options: string[]): string | undefined {
  const tagged = options.find((o) => /推荐|默认|大多数/.test(o))
  return tagged ?? options[0]
}
