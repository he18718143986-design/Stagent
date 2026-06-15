import React, { useMemo, useState } from 'react'
import { simpleTheme } from '../../theme'
import type { CockpitScreenProps } from '../../types'
import { PillOptionGroup, inferRecommendedOption } from '../../components/PillOptionGroup'

export function SimpleClarifyScreen({ engine, form, send }: CockpitScreenProps): React.JSX.Element {
  const { state } = engine
  const { draft, taskType, workspacePath } = form
  const questions = state.clarify ?? []
  const [expanded, setExpanded] = useState(false)

  const visibleQuestions = useMemo(() => {
    if (expanded || questions.length <= 2) {
      return questions
    }
    return questions.slice(0, 2)
  }, [expanded, questions])

  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const q of questions) {
      const rec = inferRecommendedOption(q.options ?? [])
      if (rec) {
        init[q.id] = rec
      }
    }
    return init
  })

  const submit = (useDefaults: boolean): void => {
    const payload: Record<string, string> = {}
    for (const q of questions) {
      if (useDefaults) {
        payload[q.id] = inferRecommendedOption(q.options ?? []) ?? answers[q.id] ?? ''
      } else {
        payload[q.id] = answers[q.id] ?? inferRecommendedOption(q.options ?? []) ?? ''
      }
    }
    void send({
      type: 'generateWorkflow',
      userInput: draft.trim(),
      taskType,
      taskWorkspacePath: workspacePath.trim(),
      clarifyAnswers: payload,
      ...(state.polished
        ? { polishContext: { originalDraft: draft, polishedAt: state.polished.polishedAt } }
        : {}),
    })
  }

  if (questions.length === 0) {
    return (
      <div className={`${simpleTheme.card} max-w-lg w-full mx-auto text-center text-stone-500`}>
        正在准备问题…
      </div>
    )
  }

  return (
    <div className={`${simpleTheme.card} max-w-lg w-full mx-auto`}>
      <h1 className={`${simpleTheme.heading} text-center mb-1`}>几个问题想跟你确认一下 👋</h1>
      <p className={`${simpleTheme.subheading} text-center mb-6`}>选一下就好，拿不准就用我们推荐的 😊</p>
      <div className="space-y-6 mb-8">
        {visibleQuestions.map((q) => (
          <div key={q.id} className="p-4 rounded-xl bg-orange-50/50 border border-orange-100">
            <PillOptionGroup
              question={{
                id: q.id,
                text: q.text,
                options: q.options,
                recommendedOption: inferRecommendedOption(q.options ?? []),
              }}
              value={answers[q.id] ?? inferRecommendedOption(q.options ?? []) ?? ''}
              onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
            />
          </div>
        ))}
      </div>
      {!expanded && questions.length > 2 && (
        <button
          type="button"
          className={`${simpleTheme.secondaryBtn} w-full mb-3 text-center`}
          onClick={() => setExpanded(true)}
        >
          ⚙️ 我自己选
        </button>
      )}
      {expanded && (
        <button
          type="button"
          className="w-full mb-3 text-xs text-stone-500 hover:text-stagent-orange"
          onClick={() => setExpanded(false)}
        >
          改回全部用推荐
        </button>
      )}
      <div className="flex flex-col sm:flex-row gap-3">
        <button type="button" className={`${simpleTheme.primaryBtn} flex-1`} onClick={() => submit(true)}>
          ✨ 都用推荐的，直接开始
        </button>
        {expanded && (
          <button type="button" className={`${simpleTheme.secondaryBtn} flex-1 text-center`} onClick={() => submit(false)}>
            选好了，继续
          </button>
        )}
      </div>
    </div>
  )
}
