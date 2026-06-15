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

/**
 * 推荐项标记:覆盖中英常见写法与符号(大小写不敏感)。
 * 仍是启发式——理想情况由后端在问题上显式给出 recommendedOption;
 * 这里尽量放宽匹配,文案微调也能命中,命不中再回退到第一项。
 */
const RECOMMENDED_MARKERS = /推荐|默认|建议|通常|一般|大多数|常用|首选|★|✓|✔|\brec(ommended)?\b|\bdefault\b/i

/** 从选项列表推断推荐项(含推荐标记的项,否则第一项)。 */
export function inferRecommendedOption(options?: string[]): string | undefined {
  if (!options || options.length === 0) {
    return undefined
  }
  const tagged = options.find((o) => RECOMMENDED_MARKERS.test(o))
  return tagged ?? options[0]
}
