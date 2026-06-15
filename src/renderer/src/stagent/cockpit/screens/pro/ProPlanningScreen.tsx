import React from 'react'
import { formatPlanSummaryLines, humanizeJargon } from '../../plainLanguage'
import { proTheme } from '../../theme'
import type { CockpitScreenProps } from '../../types'
import { isEngineInsertedStage, stageRoleColor } from '../../components/stageHelpers'
import { DecisionBoardPreview } from '../../components/DecisionGatePanel'

export function ProPlanningScreen({ engine }: CockpitScreenProps): React.JSX.Element {
  const { state, stages } = engine
  const workflow = state.workflow

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-800">规划驾驶舱</h2>
      {workflow && <div className="text-sm text-gray-600">{workflow.meta.title}</div>}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className={`${proTheme.card} space-y-2 max-h-96 overflow-y-auto`}>
          <div className="text-xs font-semibold text-gray-500 uppercase">结构 DAG</div>
          {stages.map((s, i) => (
            <div
              key={s.id}
              className={`text-xs p-2 rounded bg-gray-50 ${stageRoleColor(s.id, s.isDecisionStage)} ${
                isEngineInsertedStage(s.id) ? 'opacity-70 border-dashed' : ''
              }`}
            >
              <div className="flex gap-2">
                <span className="text-gray-400">{i + 1}</span>
                <span className="font-medium">{s.title}</span>
              </div>
              <div className="text-gray-400 mt-0.5">
                {isEngineInsertedStage(s.id) ? '引擎插入' : 'LLM 生成'} · {s.tool}
              </div>
            </div>
          ))}
        </div>
        <div className={`${proTheme.card} space-y-2 max-h-96 overflow-y-auto`}>
          <div className="text-xs font-semibold text-gray-500 uppercase">语义叙事</div>
          {state.planSummary &&
            formatPlanSummaryLines(state.planSummary).map((line) => (
              <div key={line} className="text-sm text-gray-700">
                {line}
              </div>
            ))}
          {stages.slice(0, 12).map((s) => (
            <div key={s.id} className="text-sm text-gray-600 border-l-2 border-blue-200 pl-2">
              {humanizeJargon(s.description ?? s.title)}
            </div>
          ))}
          {state.decisionBoard && state.decisionBoard.summary.total > 0 && (
            <div className="mt-2 pt-2 border-t">
              <div className="text-xs font-medium text-purple-800 mb-1">决策板摘要</div>
              <DecisionBoardPreview items={state.decisionBoard.items} />
            </div>
          )}
        </div>
        <div className={`${proTheme.card} space-y-2 max-h-96 overflow-y-auto`}>
          <div className="text-xs font-semibold text-gray-500 uppercase">风险 lint</div>
          {state.blocked &&
            state.blockReasons.map((r, i) => (
              <div key={i} className="text-sm text-red-700 bg-red-50 rounded p-2">
                🔴 {r}
              </div>
            ))}
          {state.warnings.map((w, i) => (
            <div key={i} className="text-sm text-amber-800 bg-amber-50 rounded p-2">
              🟡 {w}
            </div>
          ))}
          {!state.blocked && state.warnings.length === 0 && (
            <div className="text-sm text-green-700 bg-green-50 rounded p-2">🟢 无阻断项</div>
          )}
          {state.taskTypeClassification?.rationaleLines.map((line, i) => (
            <div key={i} className="text-xs text-blue-700">
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
