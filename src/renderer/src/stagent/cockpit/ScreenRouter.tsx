import React from 'react'
import type { CockpitEngineSlice, CockpitFormState } from './types'
import type { FrontendMessage } from '@stagent/core'
import { IntakeChatScreen } from './screens/IntakeChatScreen'
import { PlanningScreen } from './screens/PlanningScreen'
import { ExecutionScreen } from './screens/ExecutionScreen'
import { DeliveryScreen } from './screens/DeliveryScreen'

/**
 * 统一屏路由(渐进式披露)。input 阶段为对话式需求接入(开场/理解/澄清合一),
 * 之后 规划 / 执行 / 交付;由屏内的 showTechnical 控制展开密度。
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
  const { state } = engine
  const props = { engine, form, onNewTask, send, onStartClarifyFlow, clarifyPending }

  if (state.completed) {
    return <DeliveryScreen {...props} />
  }

  if (state.phase === 'execution') {
    return <ExecutionScreen engine={engine} send={send} />
  }

  if (state.phase === 'confirm') {
    return <PlanningScreen {...props} />
  }

  // phase === 'input' — 对话式接入(开场 / 理解 / 澄清合一)
  return <IntakeChatScreen {...props} showSettings={showSettings} setShowSettings={setShowSettings} />
}
