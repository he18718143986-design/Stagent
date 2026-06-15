import React from 'react'
import type { FrontendMessage } from '@stagent/core'
import type { CockpitEngineSlice } from '../../types'
import { StatusBadge } from '../../components/stageHelpers'
import { QuestionForm } from '../../components/QuestionForm'
import { DecisionReview } from '../../components/DecisionReview'
import { RetryBox, renderOutput } from '../../components/RetryBox'
import { proTheme } from '../../theme'

export function ProExecutionScreen({
  engine,
  send,
  reviewDecision,
}: {
  engine: CockpitEngineSlice
  send: (msg: FrontendMessage) => Promise<void>
  reviewDecision: CockpitEngineSlice['reviewDecision']
}): React.JSX.Element {
  const { state, stages } = engine

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">{state.workflow?.meta.title ?? '执行 · 验证'}</h2>
        <button
          type="button"
          className="text-xs text-gray-500 hover:underline"
          onClick={() => void send({ type: 'copyDebugLog' })}
        >
          复制调试日志
        </button>
      </div>
      <div className={`${proTheme.card} text-xs text-gray-500`}>
        成本条（占位）：叶子 — / 决策 — / 集成 — tokens
      </div>
      {state.engineActivityFeed.length > 0 && (
        <div className="border border-gray-200 rounded-lg p-3 text-xs space-y-1 max-h-32 overflow-y-auto">
          <div className="font-medium text-gray-600">引擎活动</div>
          {state.engineActivityFeed.slice(-8).map((e, i) => (
            <div key={i} className="text-gray-600">
              [{e.kind}] {e.text}
            </div>
          ))}
        </div>
      )}
      {state.failed && (
        <div className="border border-red-200 bg-red-50 rounded-lg p-3 text-sm text-red-700">
          ✗ {state.failed.reason}
        </div>
      )}
      <div className="space-y-3">
        {stages.map((s, i) => {
          const status = state.stageStatus[s.id] ?? 'pending'
          const stream = state.streams[s.id]
          const outputs = state.outputs[s.id]
          const confidence = state.confidence[s.id]
          const err = state.errors[s.id]
          const qb = state.questionsBefore[s.id]
          const q = state.questions[s.id]
          const arts = state.artifacts[s.id]
          const isDecision = state.decisionStageId === s.id
          const isPaused = state.pausedStageId === s.id
          const isFocused = state.focusFailedStageId === s.id
          return (
            <div
              key={s.id}
              id={isFocused ? 'stagent-focus-stage' : undefined}
              className={`${proTheme.card} ${isFocused ? 'ring-2 ring-orange-300' : ''}`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-400">{i + 1}</span>
                <span className="text-sm font-medium">{s.title}</span>
                <StatusBadge status={status} />
                {confidence && (
                  <span className="text-[11px] text-gray-500">置信 {Math.round(confidence.score * 100)}%</span>
                )}
              </div>
              {stream && (
                <pre className="mt-2 text-xs bg-gray-900 text-gray-100 rounded p-2 overflow-x-auto max-h-48 whitespace-pre-wrap">
                  {stream}
                </pre>
              )}
              {outputs &&
                Object.entries(outputs).map(([k, v]) => (
                  <pre key={k} className="mt-2 text-xs bg-gray-50 border rounded p-2 max-h-32 overflow-auto whitespace-pre-wrap">
                    {renderOutput(v)}
                  </pre>
                ))}
              {arts && arts.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
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
              {qb && qb.length > 0 && (
                <QuestionForm
                  title="执行前需要你回答："
                  questions={qb}
                  onSubmit={(answers) => void send({ type: 'answerQuestionsBefore', stageId: s.id, answers })}
                />
              )}
              {q && q.length > 0 && (
                <QuestionForm
                  title="本阶段追问："
                  questions={q}
                  onSubmit={(answers) => void send({ type: 'answerQuestions', stageId: s.id, answers })}
                />
              )}
              {isDecision && (
                <DecisionReview
                  stageId={s.id}
                  onApprove={(decisionRecord) =>
                    void send({ type: 'approveDecision', stageId: s.id, decisionRecord })
                  }
                  onReview={reviewDecision}
                />
              )}
              {isPaused && !isDecision && (
                <button
                  type="button"
                  className="mt-2 text-sm bg-blue-600 text-white px-3 py-1.5 rounded"
                  onClick={() => void send({ type: 'approve', stageId: s.id })}
                >
                  确认并继续
                </button>
              )}
              {(err || status === 'error') && (
                <div className="mt-2 border border-red-200 bg-red-50 rounded p-2 text-sm text-red-700">
                  {err?.userBody ?? err?.error ?? '阶段失败'}
                  <RetryBox onRetry={(comment) => void send({ type: 'retry', stageId: s.id, comment })} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
