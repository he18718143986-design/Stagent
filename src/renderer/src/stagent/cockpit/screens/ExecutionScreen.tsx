import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { FrontendMessage } from '@stagent/core'
import { humanizeJargon } from '../plainLanguage'
import { simpleTheme } from '../theme'
import type { CockpitEngineSlice } from '../types'
import { ProgressRing } from '../components/ProgressRing'
import { CredibilityStrip } from '../components/CredibilityStrip'
import { ExecutionQualityBar } from '../components/ExecutionQualityBar'
import { MiniDag } from '../components/MiniDag'
import { QuestionForm } from '../components/QuestionForm'
import { DecisionReview } from '../components/DecisionReview'
import { RetryBox, renderOutput } from '../components/RetryBox'
import { TechnicalDetailsCollapsible } from '../components/TechnicalDetailsCollapsible'
import { ArtifactsPanel } from '../components/ArtifactsPanel'
import { filterPlanSteps, simpleStageStatusLabel } from '../components/stageHelpers'
import { deriveProgress } from '../derive/progress'
import { newArtifactPaths } from '../derive/newArtifactPaths'
import { deriveExecutionActivity, pickExecutionStart, formatElapsed } from '../derive/executionActivity'

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
  const workspacePath = state.workflow?.meta?.taskWorkspacePath ?? ''
  const newPaths = useMemo(() => newArtifactPaths(state.artifacts), [state.artifacts])

  const activity = useMemo(
    () =>
      deriveExecutionActivity({
        stages,
        stageStatus: state.stageStatus,
        decisionStageId,
        pausedStageId,
        questionsBefore: state.questionsBefore,
        questions: state.questions,
        engineActivityFeed: state.engineActivityFeed,
      }),
    [stages, state.stageStatus, decisionStageId, pausedStageId, state.questionsBefore, state.questions, state.engineActivityFeed],
  )
  const startRef = useRef<number>(pickExecutionStart(state.engineActivityFeed, Date.now()))
  const [now, setNow] = useState<number>(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className={`${simpleTheme.card} max-w-2xl w-full mx-auto`}>
      <div className="flex items-center gap-4 mb-4">
        <ProgressRing percent={progress.percent} size={84} label="执行进度" />
        <div className="min-w-0">
          <h1 className={`${simpleTheme.hero} text-xl`}>正在帮你做…</h1>
          <div className={`${simpleTheme.subheading} mt-1 flex items-center gap-2 flex-wrap`}>
            <span className="truncate">
              {activity.state === 'self-heal'
                ? `🔧 正在自动修复…（第 ${activity.selfHealAttempts} 次）`
                : activity.state === 'waiting-you'
                  ? '⏸ 在等你确认'
                  : activity.currentTitle
                    ? `⟳ 正在:${humanizeJargon(activity.currentTitle)}`
                    : '⟳ 处理中…'}
            </span>
            <span className="text-slate-500 tabular-nums shrink-0">· 已用 {formatElapsed(now - startRef.current)}</span>
          </div>
          {activity.state === 'self-heal' && (
            <div className="text-xs text-amber-300 mt-1">遇到问题会自动重试,通常不用你管</div>
          )}
        </div>
      </div>

      <CredibilityStrip confidence={state.confidence} className="mb-3" />

      <ExecutionQualityBar qualityReport={state.qualityReport} />

      <ul className="space-y-2 mb-4">
        {planSteps.map((s) => {
          const status = state.stageStatus[s.id] ?? 'pending'
          const { label, tone } = simpleStageStatusLabel(status)
          const active = tone === 'active'
          return (
            <li
              key={s.id}
              className={`flex items-center justify-between p-3 rounded-xl ${active ? 'bg-orange-500/10 border border-orange-500/20' : 'bg-white/5'}`}
            >
              <span className="text-sm text-slate-200">{humanizeJargon(s.title)}</span>
              <span
                className={`text-xs font-medium ${
                  tone === 'done' ? 'text-green-400' : tone === 'active' ? 'text-stagent-orange' : 'text-slate-500'
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
        <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-4 mb-4">
          <div className="font-medium text-purple-200 mb-2">需要你确认一个关键决策</div>
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
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 mb-4">
          <div className="text-sm text-slate-300 mb-2">已暂停,等待你确认后继续。</div>
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
          className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 mb-4 text-sm text-red-300"
        >
          <div className="font-medium mb-1">这一步出错了:{humanizeJargon(erroredStage.title)}</div>
          {state.errors[erroredStage.id]?.userBody ?? state.errors[erroredStage.id]?.error ?? '阶段失败'}
          <RetryBox onRetry={(comment) => void send({ type: 'retry', stageId: erroredStage.id, comment })} />
        </div>
      )}

      {state.failed && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300 mb-4">
          {state.failed.reason}
        </div>
      )}

      {/* ── 成果生长(从无到有的文件树) ──────────────────────────── */}
      {workspacePath && (
        <div className="mb-4">
          <ArtifactsPanel
            rootPath={workspacePath}
            newPaths={newPaths}
            refreshNonce={state.fileTreeRevision}
            onOpenFolder={() => void send({ type: 'openArtifactFile', stageId: '', filePath: workspacePath })}
            onSelectFile={(n) => void send({ type: 'openArtifactFile', stageId: '', filePath: n.path })}
          />
        </div>
      )}

      {/* ── 折叠技术视图(跟随 showTechnical) ──────────────────────── */}
      <TechnicalDetailsCollapsible title="技术细节(逐阶段 / 引擎活动)">
        <div className="space-y-3 py-1">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-slate-300">结构</span>
              <button type="button" className="text-slate-400 hover:underline" onClick={() => void send({ type: 'copyDebugLog' })}>
                复制调试日志
              </button>
            </div>
            <MiniDag stages={stages} stageStatus={state.stageStatus} />
          </div>
          {state.engineActivityFeed.length > 0 && (
            <div>
              <div className="font-medium text-slate-300 mb-1">引擎活动</div>
              {state.engineActivityFeed.slice(-8).map((e, i) => (
                <div key={i} className="text-slate-400">
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
              <div key={s.id} className="border-t border-white/10 pt-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-300">{s.title}</span>
                  {confidence && <span className="text-slate-500">置信 {Math.round(confidence.score * 100)}%</span>}
                </div>
                {stream && (
                  <pre className="mt-1 text-[11px] bg-gray-900 text-gray-100 rounded p-2 overflow-x-auto max-h-40 whitespace-pre-wrap">
                    {stream}
                  </pre>
                )}
                {outputs &&
                  Object.entries(outputs).map(([k, v]) => (
                    <pre key={k} className="mt-1 text-[11px] bg-white/5 border border-white/10 rounded p-2 max-h-32 overflow-auto whitespace-pre-wrap text-slate-300">
                      {renderOutput(v)}
                    </pre>
                  ))}
                {arts && arts.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {arts.map((a, ai) => (
                      <button
                        key={ai}
                        type="button"
                        className="text-[11px] text-stagent-accent border border-stagent-accent/30 rounded px-2 py-0.5"
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
