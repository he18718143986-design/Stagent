import React, { useState } from 'react'
import { PillOptionGroup, inferRecommendedOption, type PillQuestion } from './PillOptionGroup'
import { plainProvenanceLabel } from '../plainLanguage'

export function DecisionGatePanel({
  questions,
  onSubmit,
  submitLabel = '带澄清答案生成工作流',
  pro = false,
}: {
  questions: PillQuestion[]
  onSubmit: (answers: Record<string, string>) => void
  submitLabel?: string
  pro?: boolean
}): React.JSX.Element {
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const q of questions) {
      const rec = q.recommendedOption ?? inferRecommendedOption(q.options ?? [])
      if (rec) {
        init[q.id] = rec
      }
    }
    return init
  })

  if (pro) {
    return (
      <div className="space-y-4 border border-purple-500/30 bg-purple-500/10/50 rounded-lg p-4">
        <div className="text-sm font-medium text-purple-200">决策闸门</div>
        {questions.map((q) => (
          <div key={q.id} className="space-y-2 bg-stagent-surface rounded-lg p-3 border border-purple-500/30">
            <PillOptionGroup
              question={{ ...q, recommendedOption: q.recommendedOption ?? inferRecommendedOption(q.options ?? []) }}
              value={answers[q.id] ?? ''}
              onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
            />
          </div>
        ))}
        <button
          type="button"
          className="text-sm bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700"
          onClick={() => onSubmit(answers)}
        >
          {submitLabel}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {questions.map((q) => (
        <PillOptionGroup
          key={q.id}
          question={{ ...q, recommendedOption: q.recommendedOption ?? inferRecommendedOption(q.options ?? []) }}
          value={answers[q.id] ?? ''}
          onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
        />
      ))}
    </div>
  )
}

import type { DecisionBoardItem } from '@stagent/core'

export function DecisionBoardPreview({
  items,
}: {
  items: DecisionBoardItem[]
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      {items.slice(0, 8).map((item, i) => (
        <div key={i} className="text-xs text-purple-200 flex gap-2">
          <span>•</span>
          <span>
            {item.stageTitle ?? item.stageId}
            {item.provenance ? ` · ${plainProvenanceLabel(String(item.provenance))}` : ''}
            {item.requiresUser ? '（需确认）' : ''}
          </span>
        </div>
      ))}
    </div>
  )
}
