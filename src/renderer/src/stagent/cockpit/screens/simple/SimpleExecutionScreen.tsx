import React, { useMemo } from 'react'
import type { FrontendMessage } from '@stagent/core'
import { humanizeJargon } from '../../plainLanguage'
import { simpleTheme } from '../../theme'
import type { CockpitEngineSlice, CockpitFormState } from '../../types'
import { QuestionForm } from '../../components/QuestionForm'
import { TechnicalDetailsCollapsible } from '../../components/TechnicalDetailsCollapsible'
import { filterPlanSteps, simpleStageStatusLabel } from '../../components/stageHelpers'

export function SimpleExecutionScreen({
  engine,
  send,
}: {
  engine: CockpitEngineSlice
  send: (msg: FrontendMessage) => Promise<void>
}): React.JSX.Element {
  const { state, stages } = engine
  const planSteps = useMemo(() => filterPlanSteps(stages), [stages])

  const doneCount = planSteps.filter((s) => {
    const st = state.stageStatus[s.id]
    return st === 'done' || st === 'skipped'
  }).length
  const progress = planSteps.length ? Math.round((doneCount / planSteps.length) * 100) : 0

  const testPassCount = state.qualityReport
    ? state.qualityReport.verificationRows.reduce((n, r) => n + r.passCount, 0)
    : null

  const pendingQuestions = useMemo(() => {
    for (const s of stages) {
      const qb = state.questionsBefore[s.id]
      if (qb?.length) {
        return { stageId: s.id, questions: qb, kind: 'before' as const }
      }
      const q = state.questions[s.id]
      if (q?.length) {
        return { stageId: s.id, questions: q, kind: 'after' as const }
      }
    }
    return null
  }, [stages, state.questionsBefore, state.questions])

  return (
    <div className={`${simpleTheme.card} max-w-lg w-full mx-auto`}>
      <div className="text-center mb-4">
        <div className="text-3xl mb-2">🌤️</div>
        <h1 className={`${simpleTheme.heading} text-xl`}>正在帮你做…</h1>
        <p className={`${simpleTheme.subheading} mt-1`}>都会自动测试，确保能用，你可以先去忙别的</p>
      </div>
      <div className="h-3 bg-stone-100 rounded-full overflow-hidden mb-6">
        <div
          className="h-full bg-stagent-orange rounded-full transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <ul className="space-y-2 mb-4">
        {planSteps.map((s) => {
          const status = state.stageStatus[s.id] ?? 'pending'
          const { label, tone } = simpleStageStatusLabel(status)
          const active = tone === 'active'
          return (
            <li
              key={s.id}
              className={`flex items-center justify-between p-3 rounded-xl ${active ? 'bg-orange-50 border border-orange-100' : 'bg-stone-50'}`}
            >
              <span className="text-sm text-stone-800">{humanizeJargon(s.title)}</span>
              <span
                className={`text-xs font-medium ${
                  tone === 'done' ? 'text-stagent-success' : tone === 'active' ? 'text-stagent-orange' : 'text-stone-400'
                }`}
              >
                {tone === 'active' && '⟳ '}
                {tone === 'done' && '✓ '}
                {label}
              </span>
            </li>
          )
        })}
      </ul>
      {pendingQuestions && (
        <QuestionForm
          simple
          title="需要你帮忙看一下"
          questions={pendingQuestions.questions}
          onSubmit={(answers) => {
            if (pendingQuestions.kind === 'before') {
              void send({ type: 'answerQuestionsBefore', stageId: pendingQuestions.stageId, answers })
            } else {
              void send({ type: 'answerQuestions', stageId: pendingQuestions.stageId, answers })
            }
          }}
        />
      )}
      {state.decisionStageId && (
        <div className="text-xs text-stone-500 mt-2 p-2 bg-purple-50 rounded-lg">
          正在等待内部决策完成…（简单模式已自动处理）
        </div>
      )}
      {testPassCount != null && testPassCount > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-green-50 border border-green-100 text-sm text-stagent-success mb-4">
          <span>🛡️</span>
          <span>已通过 {testPassCount} 项自动测试</span>
        </div>
      )}
      {state.failed && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 mb-4">
          {state.failed.reason}
        </div>
      )}
      <TechnicalDetailsCollapsible>
        {state.engineActivityFeed.slice(-5).map((e, i) => (
          <div key={i}>{e.text}</div>
        ))}
      </TechnicalDetailsCollapsible>
    </div>
  )
}
