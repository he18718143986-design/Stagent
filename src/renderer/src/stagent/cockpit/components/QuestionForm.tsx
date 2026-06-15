import React, { useState } from 'react'
import type { Question } from '@stagent/core'
import { plainProvenanceLabel } from '../plainLanguage'
import { PillOptionGroup } from './PillOptionGroup'

function seedAnswersFromQuestions(questions: Question[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const q of questions) {
    const suggested = q.suggestedAnswer?.trim()
    if (suggested) {
      out[q.id] = suggested
    }
  }
  return out
}

export function QuestionForm({
  title,
  questions,
  onSubmit,
  simple = false,
}: {
  title: string
  questions: Question[]
  onSubmit: (answers: Record<string, string>) => void
  simple?: boolean
}): React.JSX.Element {
  const [answers, setAnswers] = useState<Record<string, string>>(() => seedAnswersFromQuestions(questions))
  const missingRequired = questions.some((q) => q.required !== false && !(answers[q.id] ?? '').trim())

  if (simple) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-4">
        <div className="font-medium text-amber-900">{title || '需要你帮忙看一下'}</div>
        {questions.map((q) => (
          <div key={q.id} className="space-y-2">
            <PillOptionGroup
              question={{
                id: q.id,
                text: q.text,
                recommendedOption: q.suggestedAnswer?.trim(),
                hint: q.hint,
              }}
              value={answers[q.id] ?? ''}
              onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
              showRecommended={!!q.suggestedAnswer?.trim()}
            />
            {!q.suggestedAnswer?.trim() && (
              <textarea
                className="w-full text-sm border border-stone-200 rounded-xl px-3 py-2 min-h-[2.5rem]"
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                placeholder={q.hint ?? '请输入…'}
              />
            )}
          </div>
        ))}
        <button
          type="button"
          className="text-sm bg-stagent-orange text-white px-4 py-2 rounded-full hover:bg-orange-600 disabled:opacity-50"
          disabled={missingRequired}
          onClick={() => onSubmit(answers)}
        >
          选好了，继续
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2 border border-amber-200 bg-amber-50 rounded-lg p-3 mt-2">
      <div className="text-sm font-medium text-amber-800">{title}</div>
      {questions.map((q) => (
        <div
          key={q.id}
          className={`space-y-1 rounded px-2 py-1 ${
            q.provenance === 'charter_inferred'
              ? 'border-l-4 border-amber-400 bg-amber-50/80'
              : q.provenance === 'charter_direct'
                ? 'border-l-4 border-green-300 bg-green-50/40'
                : ''
          }`}
        >
          <label className="text-sm text-gray-700">
            {q.text}
            {q.required !== false && <span className="text-red-500"> *</span>}
          </label>
          {q.provenance && (
            <span className="inline-block text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
              {plainProvenanceLabel(q.provenance)}
              {q.ruleRefs && q.ruleRefs.length > 0 ? ` · R#${q.ruleRefs.join(',R#')}` : ''}
            </span>
          )}
          {q.hint && <div className="text-xs text-gray-400">{q.hint}</div>}
          <textarea
            className="w-full text-sm border border-gray-300 rounded px-2 py-1 resize-y min-h-[2rem]"
            value={answers[q.id] ?? ''}
            onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
          />
        </div>
      ))}
      <button
        type="button"
        className="text-sm bg-amber-600 text-white px-3 py-1.5 rounded hover:bg-amber-700 disabled:opacity-50"
        disabled={missingRequired}
        onClick={() => onSubmit(answers)}
      >
        提交回答
      </button>
    </div>
  )
}
