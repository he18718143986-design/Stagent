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
import { RiskRegisterPanel } from '../components/RiskRegisterPanel'
import { filterPlanSteps } from '../components/stageHelpers'
import { buildPlanProposal } from '../derive/planProposal'

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
  const proposal = useMemo(() => buildPlanProposal(stages), [stages])

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
        {state.busy.detail && <div className="text-sm text-slate-400 mt-2">{state.busy.detail}</div>}
      </div>
    )
  }

  if (!workflow) {
    return (
      <div className={`${simpleTheme.card} max-w-lg w-full mx-auto text-center text-slate-400`}>正在准备计划…</div>
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

        <div className="mb-2 rounded-xl border border-white/10 overflow-hidden">
          <div className="grid grid-cols-[1.2fr_1.4fr_auto] gap-x-3 px-3 py-2 text-[11px] text-slate-400 border-b border-white/10 bg-white/5">
            <span>步骤</span>
            <span>目的</span>
            <span>怎么验证</span>
          </div>
          {proposal.rows.map((r, i) => (
            <div
              key={r.id}
              className="grid grid-cols-[1.2fr_1.4fr_auto] gap-x-3 px-3 py-2 text-sm border-b border-white/5 last:border-0"
            >
              <span className="text-slate-200">
                {i + 1}. {humanizeJargon(r.step)}
              </span>
              <span className="text-slate-400">{humanizeJargon(r.purpose)}</span>
              <span className="text-xs self-center">
                {r.verification ? (
                  <span className="text-green-300">✓ {humanizeJargon(r.verification)}</span>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </span>
            </div>
          ))}
        </div>
        <div
          className={`text-xs mb-6 ${
            proposal.total > 0 && proposal.verifiedCount === proposal.total ? 'text-green-400' : 'text-amber-300'
          }`}
        >
          {proposal.verifiedCount}/{proposal.total} 个功能步骤配了自动化验证
        </div>

        <RiskRegisterPanel
          warnings={state.warnings}
          blockReasons={state.blockReasons}
          blocked={state.blocked}
        />

        {/* 闸门:红灯禁止执行(常驻,无视密度开关) — 与风险登记联动,保留简短条 */}
        {state.blocked && state.blockReasons.length > 0 && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 mb-4 text-sm text-red-300">
            🔴 暂时不能开始 — 请查看上方风险登记
          </div>
        )}

        <TechnicalDetailsCollapsible title="结构与计划细节(给开发者看)">
          <div className="space-y-4 py-1">
            <div>
              <div className="font-medium text-slate-300 mb-1">结构概览</div>
              <MiniDag stages={stages} stageStatus={state.stageStatus} />
            </div>
            {state.planSummary && (
              <div>
                <div className="font-medium text-slate-300 mb-1">语义叙事</div>
                {formatPlanSummaryLines(state.planSummary).map((line) => (
                  <div key={line} className="text-slate-400">
                    {line}
                  </div>
                ))}
              </div>
            )}
            <div>
              <div className="font-medium text-slate-300 mb-1">逐阶段</div>
              <div className="space-y-1">
                {stages.map((s, i) => (
                  <div key={s.id} className="flex items-center gap-2 flex-wrap">
                    <span className="text-slate-500">{i + 1}</span>
                    <span className="text-slate-300">{s.title}</span>
                    {s.isDecisionStage && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">decision</span>
                    )}
                    {/^stage_impl_/.test(s.id) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">impl</span>
                    )}
                    {/^stage_test_run_/.test(s.id) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-300">test</span>
                    )}
                    <span className="text-[10px] text-slate-500 ml-auto">模型:{preferredModel || '默认'}</span>
                  </div>
                ))}
              </div>
            </div>
            {state.decisionBoard && state.decisionBoard.summary.total > 0 && (
              <div>
                <div className="font-medium text-purple-300 mb-1">决策板摘要</div>
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
