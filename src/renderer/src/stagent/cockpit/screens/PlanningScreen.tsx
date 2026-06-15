import React, { useMemo, useState } from 'react'
import { useCockpitContextOptional } from '../CockpitContext'
import { formatPlanSummaryLines, humanizeJargon } from '../plainLanguage'
import { simpleTheme } from '../theme'
import type { CockpitScreenProps } from '../types'
import { ConfirmStartModal } from '../components/ConfirmStartModal'
import { TechnicalDetailsCollapsible } from '../components/TechnicalDetailsCollapsible'
import { CredibilityStrip } from '../components/CredibilityStrip'
import { MiniDag } from '../components/MiniDag'
import { DecisionBoardPreview } from '../components/DecisionGatePanel'
import { filterPlanSteps } from '../components/stageHelpers'

/**
 * 统一规划/签字屏(合并 SimplePlanning + ProPlanning + ProSignOff)。
 * 常驻:白话计划步骤、可信度带、阻断红灯(闸门)、批准/开始(闸门)。
 * 折叠(默认开合跟随 showTechnical):结构 DAG、语义叙事、风险 lint、
 * 决策板、逐阶段角色/模型。决策不自动批准——开始执行前由用户显式批准。
 */
export function PlanningScreen({ engine, form, send, onNewTask }: CockpitScreenProps): React.JSX.Element {
  const ctx = useCockpitContextOptional()
  const showTechnical = ctx?.showTechnical ?? false
  const { state, stages, preferredModel } = engine
  const [modalOpen, setModalOpen] = useState(false)

  const planSteps = useMemo(() => filterPlanSteps(stages), [stages])

  const workflow = state.workflow

  const summaryLines = useMemo(() => {
    const title = workflow?.meta.title || form.draft.trim().slice(0, 30)
    return [
      title,
      `${planSteps.length} 个功能步骤`,
      state.qualityReport
        ? `${state.qualityReport.verificationRows.reduce((n, r) => n + r.passCount, 0)} 项自动测试`
        : '含自动测试',
    ]
  }, [workflow?.meta.title, form.draft, planSteps.length, state.qualityReport])

  if (state.busy) {
    return (
      <div className={`${simpleTheme.card} max-w-lg w-full mx-auto text-center py-12`}>
        <div className="animate-pulse text-stagent-orange font-medium">{state.busy.message}</div>
        {state.busy.detail && <div className="text-sm text-stone-500 mt-2">{state.busy.detail}</div>}
      </div>
    )
  }

  if (!workflow) {
    return (
      <div className={`${simpleTheme.card} max-w-lg w-full mx-auto text-center text-stone-500`}>正在准备计划…</div>
    )
  }

  const startExecution = (): void => {
    void send({
      type: 'startExecution',
      workflow: state.workflow,
      instanceKey: state.activeInstanceKey ?? state.draftInstanceKey,
    })
    setModalOpen(false)
  }

  return (
    <>
      <div className={`${simpleTheme.card} max-w-2xl w-full mx-auto`}>
        <h1 className={`${simpleTheme.hero} mb-1`}>我们打算这样做</h1>
        <p className={`${simpleTheme.subheading} mb-4`}>看一下对不对,不对就告诉我们</p>

        <CredibilityStrip confidence={state.confidence} className="mb-5" />

        <ol className="space-y-3 mb-6">
          {planSteps.map((s, i) => (
            <li key={s.id} className="flex gap-3 p-3 rounded-xl bg-stone-50 border border-stone-100">
              <span className="w-7 h-7 rounded-full bg-white border border-stone-200 flex items-center justify-center text-sm font-semibold text-stagent-orange shrink-0">
                {i + 1}
              </span>
              <span className="text-sm text-stone-800 pt-0.5">{humanizeJargon(s.title)}</span>
            </li>
          ))}
        </ol>

        {state.warnings.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mb-4">
            <div className="font-medium text-amber-900 mb-1">❓ 需要你确认的地方</div>
            <p className="text-sm text-amber-800">{humanizeJargon(state.warnings[0])}</p>
          </div>
        )}

        {/* 闸门:红灯禁止执行(常驻,无视密度开关) */}
        {state.blocked && state.blockReasons.length > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 mb-4 text-sm text-red-700">
            🔴 还有地方没对上,暂时不能开始。{humanizeJargon(state.blockReasons[0])}
          </div>
        )}

        <TechnicalDetailsCollapsible title="结构与计划细节(给开发者看)">
          <div className="space-y-4 py-1">
            <div>
              <div className="font-medium text-stone-600 mb-1">结构概览</div>
              <MiniDag stages={stages} stageStatus={state.stageStatus} />
            </div>
            {state.planSummary && (
              <div>
                <div className="font-medium text-stone-600 mb-1">语义叙事</div>
                {formatPlanSummaryLines(state.planSummary).map((line) => (
                  <div key={line} className="text-stone-600">
                    {line}
                  </div>
                ))}
              </div>
            )}
            <div>
              <div className="font-medium text-stone-600 mb-1">逐阶段</div>
              <div className="space-y-1">
                {stages.map((s, i) => (
                  <div key={s.id} className="flex items-center gap-2 flex-wrap">
                    <span className="text-stone-400">{i + 1}</span>
                    <span className="text-stone-700">{s.title}</span>
                    {s.isDecisionStage && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">decision</span>
                    )}
                    {/^stage_impl_/.test(s.id) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">impl</span>
                    )}
                    {/^stage_test_run_/.test(s.id) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">test</span>
                    )}
                    <span className="text-[10px] text-stone-400 ml-auto">模型:{preferredModel || '默认'}</span>
                  </div>
                ))}
              </div>
            </div>
            {(state.warnings.length > 0 || state.blockReasons.length > 0) && (
              <div>
                <div className="font-medium text-stone-600 mb-1">风险 lint</div>
                {state.blockReasons.map((r, i) => (
                  <div key={`b${i}`} className="text-red-700">
                    🔴 {r}
                  </div>
                ))}
                {state.warnings.map((w, i) => (
                  <div key={`w${i}`} className="text-amber-700">
                    🟡 {w}
                  </div>
                ))}
              </div>
            )}
            {state.decisionBoard && state.decisionBoard.summary.total > 0 && (
              <div>
                <div className="font-medium text-purple-800 mb-1">决策板摘要</div>
                <DecisionBoardPreview items={state.decisionBoard.items} />
              </div>
            )}
          </div>
        </TechnicalDetailsCollapsible>

        {/* 闸门:显式批准 / 开始执行(常驻,决策不自动批准) */}
        <div className="flex flex-col sm:flex-row gap-3 mt-6">
          <button
            type="button"
            className={`${simpleTheme.primaryBtn} flex-1`}
            disabled={state.blocked}
            onClick={() => setModalOpen(true)}
          >
            {showTechnical ? '批准并开始执行' : '看起来不错,开始做'}
          </button>
          <button type="button" className={`${simpleTheme.secondaryBtn} flex-1 text-center`} onClick={onNewTask}>
            我想改改
          </button>
        </div>
      </div>
      <ConfirmStartModal
        open={modalOpen && !state.blocked}
        summaryLines={summaryLines}
        onConfirm={startExecution}
        onCancel={() => setModalOpen(false)}
      />
    </>
  )
}
