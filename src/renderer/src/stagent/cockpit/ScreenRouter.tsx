import React from 'react'
import { useCockpitContext } from './CockpitContext'
import type { CockpitEngineSlice, CockpitFormState } from './types'
import type { FrontendMessage } from '@stagent/core'
import { IntentScreen } from './screens/IntentScreen'
import { ClarifyScreen } from './screens/ClarifyScreen'
import { PlanningScreen } from './screens/PlanningScreen'
import { SimpleExecutionScreen } from './screens/simple/SimpleExecutionScreen'
import { SimpleDeliveryScreen } from './screens/simple/SimpleDeliveryScreen'
import { ProExecutionScreen } from './screens/pro/ProExecutionScreen'
import { ProDeliveryScreen } from './screens/pro/ProDeliveryScreen'

function Loading({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="max-w-lg mx-auto text-center py-12 text-stagent-orange animate-pulse">{text}</div>
  )
}

/**
 * 统一屏路由(渐进式披露)。意图 / 澄清 / 规划三屏已合并为单版,
 * 由屏内的 showTechnical 控制展开密度;执行 / 交付屏暂仍按密度选择
 * 旧 Simple/Pro 版本(阶段 D 合并)。
 */
export function ScreenRouter({
  engine,
  form,
  onNewTask,
  send,
  showSettings,
  setShowSettings,
  onStartClarifyFlow,
  clarifyPending = false,
}: {
  engine: CockpitEngineSlice
  form: CockpitFormState
  onNewTask: () => void
  send: (msg: FrontendMessage) => Promise<void>
  showSettings: boolean
  setShowSettings: (v: boolean) => void
  onStartClarifyFlow?: () => void
  clarifyPending?: boolean
}): React.JSX.Element {
  const { showTechnical } = useCockpitContext()
  const { state } = engine
  const props = { engine, form, onNewTask, send, onStartClarifyFlow, clarifyPending }

  if (state.completed) {
    return showTechnical ? <ProDeliveryScreen {...props} /> : <SimpleDeliveryScreen {...props} />
  }

  if (state.phase === 'execution') {
    return showTechnical ? (
      <ProExecutionScreen engine={engine} send={send} reviewDecision={engine.reviewDecision} />
    ) : (
      <SimpleExecutionScreen engine={engine} send={send} />
    )
  }

  if (state.phase === 'confirm') {
    return <PlanningScreen {...props} />
  }

  // phase === 'input'
  if (state.clarify?.length) {
    return <ClarifyScreen {...props} />
  }
  if (clarifyPending || state.busy) {
    return <Loading text={state.busy?.message ?? '正在理解你的需求…'} />
  }
  return <IntentScreen {...props} showSettings={showSettings} setShowSettings={setShowSettings} />
}
