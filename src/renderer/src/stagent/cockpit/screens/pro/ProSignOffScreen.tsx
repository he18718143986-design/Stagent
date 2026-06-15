import React from 'react'
import { proTheme } from '../../theme'
import type { CockpitScreenProps } from '../../types'
import { stageRoleColor } from '../../components/stageHelpers'

export function ProSignOffScreen({ engine, send }: CockpitScreenProps): React.JSX.Element {
  const { state, stages, preferredModel } = engine
  const workflow = state.workflow!

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">决策 · 计划签字</h2>
        <span className="text-xs text-gray-400">{stages.length} 阶段</span>
      </div>
      {state.blocked && (
        <div className="border border-red-200 bg-red-50 rounded-lg p-3 text-sm text-red-700">
          红灯：禁止执行。{state.blockReasons.join('；')}
        </div>
      )}
      <div className="space-y-2">
        {stages.map((s, i) => (
          <div key={s.id} className={`${proTheme.card} ${stageRoleColor(s.id, s.isDecisionStage)}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-400">{i + 1}</span>
              <span className="text-sm font-medium">{s.title}</span>
              {s.isDecisionStage && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">decision</span>
              )}
              {/^stage_impl_/.test(s.id) && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">impl</span>
              )}
              {/^stage_test_run_/.test(s.id) && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">test</span>
              )}
              <span className="text-[10px] text-gray-400 ml-auto">模型：{preferredModel || '默认'}</span>
            </div>
            {s.description && <div className="text-xs text-gray-500 mt-1">{s.description}</div>}
          </div>
        ))}
      </div>
      <button
        type="button"
        className="text-sm bg-blue-600 text-white rounded-lg px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
        disabled={state.blocked}
        onClick={() =>
          void send({
            type: 'startExecution',
            workflow,
            instanceKey: state.activeInstanceKey ?? state.draftInstanceKey,
          })
        }
      >
        批准并开始执行
      </button>
    </div>
  )
}
