import React, { useMemo, useState } from 'react'
import { humanizeJargon } from '../../plainLanguage'
import { simpleTheme } from '../../theme'
import type { CockpitScreenProps } from '../../types'
import { ConfirmStartModal } from '../../components/ConfirmStartModal'
import { TechnicalDetailsCollapsible } from '../../components/TechnicalDetailsCollapsible'
import { filterPlanSteps } from '../../components/stageHelpers'

export function SimplePlanningScreen({ engine, form, send, onNewTask }: CockpitScreenProps): React.JSX.Element {
  const { state, stages } = engine
  const workflow = state.workflow!
  const [modalOpen, setModalOpen] = useState(false)

  const planSteps = useMemo(() => filterPlanSteps(stages), [stages])

  const summaryLines = useMemo(() => {
    const title = workflow.meta.title || form.draft.trim().slice(0, 30)
    return [
      title,
      `${planSteps.length} 个功能步骤`,
      state.qualityReport
        ? `${state.qualityReport.verificationRows.reduce((n, r) => n + r.passCount, 0)} 项自动测试`
        : '含自动测试',
    ]
  }, [workflow.meta.title, form.draft, planSteps.length, state.qualityReport])

  const startExecution = (): void => {
    void send({
      type: 'startExecution',
      workflow: state.workflow,
      instanceKey: state.activeInstanceKey ?? state.draftInstanceKey,
    })
    setModalOpen(false)
  }

  if (state.busy) {
    return (
      <div className={`${simpleTheme.card} max-w-lg w-full mx-auto text-center py-12`}>
        <div className="animate-pulse text-stagent-orange font-medium">{state.busy.message}</div>
        {state.busy.detail && <div className="text-sm text-stone-500 mt-2">{state.busy.detail}</div>}
      </div>
    )
  }

  return (
    <>
      <div className={`${simpleTheme.card} max-w-lg w-full mx-auto`}>
        <h1 className={`${simpleTheme.heading} mb-1`}>我们打算这样做</h1>
        <p className={`${simpleTheme.subheading} mb-6`}>看一下对不对，不对就告诉我们</p>
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
        {state.blocked && state.blockReasons.length > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 mb-4 text-sm text-red-700">
            还有地方没对上，暂时不能开始。{humanizeJargon(state.blockReasons[0])}
          </div>
        )}
        <TechnicalDetailsCollapsible>
          {stages.map((s) => (
            <div key={s.id}>
              {s.id}: {s.title}
            </div>
          ))}
          {state.planSummary && (
            <div className="mt-2 text-stone-500">共 {state.planSummary.stageCount} 个阶段</div>
          )}
        </TechnicalDetailsCollapsible>
        <div className="flex flex-col sm:flex-row gap-3 mt-6">
          <button
            type="button"
            className={`${simpleTheme.primaryBtn} flex-1`}
            disabled={state.blocked}
            onClick={() => setModalOpen(true)}
          >
            看起来不错，开始做
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
