import React from 'react'
import type { CockpitEngineSlice, CockpitFormState } from './types'
import type { FrontendMessage } from '@stagent/core'
import { IntentScreen } from './screens/IntentScreen'
import { ClarifyScreen } from './screens/ClarifyScreen'
import { PlanningScreen } from './screens/PlanningScreen'
import { ExecutionScreen } from './screens/ExecutionScreen'
import { DeliveryScreen } from './screens/DeliveryScreen'

function Loading({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="max-w-lg mx-auto text-center py-12 text-stagent-orange animate-pulse">{text}</div>
  )
}

/**
 * 统一屏路由(渐进式披露)。意图 / 澄清 / 规划 / 执行 / 交付五屏均已合并为
 * 单版,由屏内的 showTechnical 控制展开密度;不再按 uiMode 分叉。
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

  // phase === 'input'
  if (state.clarify?.length) {
    return <ClarifyScreen {...props} />
  }
  if (clarifyPending || state.busy) {
    return <Loading text={state.busy?.message ?? '正在理解你的需求…'} />
  }
  return <IntentScreen {...props} showSettings={showSettings} setShowSettings={setShowSettings} />
}
