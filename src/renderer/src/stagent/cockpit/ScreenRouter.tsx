import React from 'react'
import { deriveProStep, deriveSimpleStep } from './deriveCockpitStep'
import { useCockpitContext } from './CockpitContext'
import type { CockpitEngineSlice, CockpitFormState } from './types'
import type { FrontendMessage } from '@stagent/core'
import { SimpleIntentScreen } from './screens/simple/SimpleIntentScreen'
import { SimpleClarifyScreen } from './screens/simple/SimpleClarifyScreen'
import { SimplePlanningScreen } from './screens/simple/SimplePlanningScreen'
import { SimpleExecutionScreen } from './screens/simple/SimpleExecutionScreen'
import { SimpleDeliveryScreen } from './screens/simple/SimpleDeliveryScreen'
import { ProIntentScreen } from './screens/pro/ProIntentScreen'
import { ProClarifyScreen } from './screens/pro/ProClarifyScreen'
import { ProPlanningScreen } from './screens/pro/ProPlanningScreen'
import { ProSignOffScreen } from './screens/pro/ProSignOffScreen'
import { ProExecutionScreen } from './screens/pro/ProExecutionScreen'
import { ProDeliveryScreen } from './screens/pro/ProDeliveryScreen'

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
  const { uiMode } = useCockpitContext()
  const { state } = engine
  const props = { engine, form, onNewTask, send, onStartClarifyFlow, clarifyPending }

  if (uiMode === 'simple') {
    const simpleStep = deriveSimpleStep(state)
    if (simpleStep === 1) {
      if (state.clarify?.length) {
        return <SimpleClarifyScreen {...props} />
      }
      if (clarifyPending && state.phase === 'input') {
        return (
          <div className="max-w-lg mx-auto text-center py-12 text-stagent-orange animate-pulse">
            正在理解你的需求…
          </div>
        )
      }
      return <SimpleIntentScreen {...props} />
    }
    if (simpleStep === 2) {
      if (state.phase === 'input' && state.clarify?.length) {
        return <SimpleClarifyScreen {...props} />
      }
      if (state.phase === 'confirm' && state.workflow) {
        return <SimplePlanningScreen {...props} />
      }
      return (
        <div className="max-w-lg mx-auto text-center py-12 text-stagent-orange animate-pulse">
          {state.busy?.message ?? (clarifyPending ? '正在理解你的需求…' : '准备中…')}
        </div>
      )
    }
    if (simpleStep === 3) {
      return <SimpleExecutionScreen engine={engine} send={send} />
    }
    return <SimpleDeliveryScreen {...props} />
  }

  const proStep = deriveProStep(state)
  if (proStep === 0) {
    return <ProIntentScreen {...props} showSettings={showSettings} setShowSettings={setShowSettings} />
  }
  if (proStep === 1) {
    return <ProClarifyScreen {...props} />
  }
  if (proStep === 2) {
    return <ProPlanningScreen {...props} />
  }
  if (proStep === 3) {
    return <ProSignOffScreen {...props} />
  }
  if (proStep === 4) {
    return <ProExecutionScreen engine={engine} send={send} reviewDecision={engine.reviewDecision} />
  }
  return <ProDeliveryScreen {...props} />
}
