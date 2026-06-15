import React, { useMemo } from 'react'
import type { FrontendMessage } from '@stagent/core'
import { humanizeJargon } from '../plainLanguage'
import { simpleTheme } from '../theme'
import type { CockpitEngineSlice } from '../types'
import { ProgressRing } from '../components/ProgressRing'
import { CredibilityStrip } from '../components/CredibilityStrip'
import { MiniDag } from '../components/MiniDag'
import { QuestionForm } from '../components/QuestionForm'
import { DecisionReview } from '../components/DecisionReview'
import { RetryBox, renderOutput } from '../components/RetryBox'
import { TechnicalDetailsCollapsible } from '../components/TechnicalDetailsCollapsible'
import { filterPlanSteps, simpleStageStatusLabel } from '../components/stageHelpers'
import { deriveProgress } from '../derive/progress'

/**
 * 统一执行/验证屏(渐进式披露)。
 * 常驻放大:英雄进度环 + 可信度带 + 白话步骤状态;以及所有交互闸门
 * (追问 / 决策 / 暂停 / 重试 / 失败)——这些无视密度开关始终显示。
 * 折叠(跟随 showTechnical):结构 DAG、引擎活动、逐阶段流/输出/产物。
 * 决策由用户在 DecisionReview 中显式批准,不自动放行。
 */
export function ExecutionScreen({
  engine,
  send,
}: {
  engine: CockpitEngineSlice
  send: (msg: FrontendMessage) => Promise<void>
}): React.JSX.Element {
  const { state, stages, reviewDecision } = engine
  const planSteps = useMemo(() => filterPlanSteps(stages), [stages])
  const progress = useMemo(() => deriveProgress(planSteps, state.stageStatus), [planSteps, state.stageStatus])

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

  const erroredStage = useMemo(
    () => stages.find((s) => state.errors[s.id] || state.stageStatus[s.id] === 'error') ?? null,
    [stages, state.errors, state.stageStatus],
  )

  const decisionStageId = state.decisionStageId
  const pausedStageId = state.pausedStageId

  return (
    <div className={`${simpleTheme.card} max-w-2xl w-full mx-auto`}>
      <div className="flex items-center gap-4 mb-4">
        <ProgressRing percent={progress.percent} size={84} label="执行进度" />
        <div className="min-w-0">
          <h1 className={`${simpleTheme.hero} text-xl`}>正在帮你做…</h1>
          <p className={`${simpleTheme.subheading} mt-1 truncate`}>
            {progress.currentTitle
              ? `正在:${humanizeJargon(progress.currentTitle)}`
              : '都会自动测试,确保能用,你可以先去忙别的'}
          </p>
        </div>
      </div>

      <CredibilityStrip confidence={state.confidence} className="mb-4" />

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

      {/* ── 闸门:始终显示、放大,无视密度开关 ───────────────────────── */}
      {decisionStageId && (
        <div className="rounded-xl border border-purple-200 bg-purple-50/60 p-4 mb-4">
          <div className="font-medium text-purple-900 mb-2">需要你确认一个关键决策</div>
          <DecisionReview
            stageId={decisionStageId}
            initialRecord={renderOutput(state.outputs[decisionStageId]?.decisionRecord)}
            onApprove={(decisionRecord) =>
              void send({ type: 'approveDecision', stageId: decisionStageId, decisionRecord })
            }
            onReview={reviewDecision}
          />
        </div>
      )}

      {pausedStageId && pausedStageId !== decisionStageId && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 mb-4">
          <div className="text-sm text-stone-700 mb-2">已暂停,等待你确认后继续。</div>
          <button
            type="button"
            className="text-sm bg-blue-600 text-white px-4 py-2 rounded-full hover:bg-blue-700"
            onClick={() => void send({ type: 'approve', stageId: pausedStageId })}
          >
            确认并继续
          </button>
        </div>
      )}

      {pendingQuestions && (
        <div className="mb-4">
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
        </div>
      )}

      {erroredStage && (
        <div
          id={state.focusFailedStageId === erroredStage.id ? 'stagent-focus-stage' : undefined}
          className="rounded-xl border border-red-200 bg-red-50 p-4 mb-4 text-sm text-red-700"
        >
          <div className="font-medium mb-1">这一步出错了:{humanizeJargon(erroredStage.title)}</div>
          {state.errors[erroredStage.id]?.userBody ?? state.errors[erroredStage.id]?.error ?? '阶段失败'}
          <RetryBox onRetry={(comment) => void send({ type: 'retry', stageId: erroredStage.id, comment })} />
        </div>
      )}

      {state.failed && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 mb-4">
          {state.failed.reason}
        </div>
      )}

      {testPassCount != null && testPassCount > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-green-50 border border-green-100 text-sm text-stagent-success mb-4">
          <span>🛡️</span>
          <span>已通过 {testPassCount} 项自动测试</span>
        </div>
      )}

      {/* ── 折叠技术视图(跟随 showTechnical) ──────────────────────── */}
      <TechnicalDetailsCollapsible title="技术细节(逐阶段 / 引擎活动)">
        <div className="space-y-3 py-1">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-stone-600">结构</span>
              <button type="button" className="text-stone-500 hover:underline" onClick={() => void send({ type: 'copyDebugLog' })}>
                复制调试日志
              </button>
            </div>
            <MiniDag stages={stages} stageStatus={state.stageStatus} />
          </div>
          {state.engineActivityFeed.length > 0 && (
            <div>
              <div className="font-medium text-stone-600 mb-1">引擎活动</div>
              {state.engineActivityFeed.slice(-8).map((e, i) => (
                <div key={i} className="text-stone-500">
                  [{e.kind}] {e.text}
                </div>
              ))}
            </div>
          )}
          {stages.map((s) => {
            const stream = state.streams[s.id]
            const outputs = state.outputs[s.id]
            const confidence = state.confidence[s.id]
            const arts = state.artifacts[s.id]
            if (!stream && !outputs && !arts?.length && !confidence) {
              return null
            }
            return (
              <div key={s.id} className="border-t border-stone-100 pt-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-stone-600">{s.title}</span>
                  {confidence && <span className="text-stone-400">置信 {Math.round(confidence.score * 100)}%</span>}
                </div>
                {stream && (
                  <pre className="mt-1 text-[11px] bg-gray-900 text-gray-100 rounded p-2 overflow-x-auto max-h-40 whitespace-pre-wrap">
                    {stream}
                  </pre>
                )}
                {outputs &&
                  Object.entries(outputs).map(([k, v]) => (
                    <pre key={k} className="mt-1 text-[11px] bg-stone-50 border rounded p-2 max-h-32 overflow-auto whitespace-pre-wrap">
                      {renderOutput(v)}
                    </pre>
                  ))}
                {arts && arts.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {arts.map((a, ai) => (
                      <button
                        key={ai}
                        type="button"
                        className="text-[11px] text-blue-600 border border-blue-200 rounded px-2 py-0.5"
                        onClick={() => void send({ type: 'openArtifactFile', stageId: s.id, filePath: a.filePath })}
                      >
                        {a.filePath}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </TechnicalDetailsCollapsible>
    </div>
  )
}
