/* ------------------------------------------------------------------ */
/*  useStagentEngine — 渲染层消费 stagent:event，驱动 @stagent/core 引擎  */
/*                                                                     */
/*  仅 import type（类型在编译期擦除），渲染包不引入任何 Node 依赖。     */
/*  引擎计算结果（planSummary / warningsDisplay / questions / artifacts） */
/*  直接由 BackendMessage 携带，UI 复用这些纯函数产物而非重复推导。     */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type {
  BackendMessage,
  DeleteScope,
  FrontendMessage,
  PlanSummary,
  Question,
  Stage,
  StageArtifactHint,
  StageStatus,
  TaskListItem,
  TaskTypeClassificationInfo,
  WorkflowDefinition,
  QualityReportPayload,
} from '@stagent/core'

export type StagentPhase = 'input' | 'confirm' | 'execution'

export interface StageConfidence {
  score: number
  level: 'high' | 'medium' | 'low' | 'critical'
  reasons: string[]
}

export interface StagentState {
  phase: StagentPhase
  busy: { message: string; detail?: string } | null
  polishHint?: string
  polished?: { text: string; polishedAt: string; fromCache?: boolean }
  clarify?: Array<{ id: string; text: string; options?: string[] }>
  pickedWorkspacePath?: string
  tasks: TaskListItem[]
  workflow?: WorkflowDefinition
  /** 确认页已持久化的 idle 草稿实例 key；「开始执行」回传复用、「放弃并重来」据此删除 */
  draftInstanceKey?: string
  /** 当前活跃/已恢复实例 key（生成、恢复、执行共用，避免重复 UUID） */
  activeInstanceKey?: string
  blocked: boolean
  blockReasons: string[]
  warnings: string[]
  planSummary?: PlanSummary | null
  /** Path Router + taskType 判别摘要（确认页决策板） */
  taskTypeClassification?: TaskTypeClassificationInfo
  /** B-R2：确认页决策板（Charter 代答分类） */
  decisionBoard?: { items: Array<Record<string, unknown>>; summary: { total: number; auto: number; needsReview: number } }
  stageStatus: Record<string, StageStatus>
  streams: Record<string, string>
  outputs: Record<string, Record<string, unknown>>
  questionsBefore: Record<string, Question[]>
  questions: Record<string, Question[]>
  /** 暂停等待人工的决策阶段（走 approveDecision） */
  decisionStageId?: string
  /** 暂停等待人工的普通阶段（走 approve） */
  pausedStageId?: string
  errors: Record<
    string,
    {
      error: string
      errorType: string
      stdout?: string
      stderr?: string
      userTitle?: string
      userBody?: string
      playbookSteps?: string[]
    }
  >
  confidence: Record<string, StageConfidence>
  artifacts: Record<string, StageArtifactHint[]>
  failed?: { reason: string; errorType: string }
  /** #5：跨实例切换被引擎拒绝时的提示（执行中切换其他任务） */
  switchBlocked?: { reason: string; targetInstanceKey: string }
  completed: boolean
  /** 屏 4：引擎活动 Feed（gate / replan / preflight）。 */
  engineActivityFeed: Array<{ kind: string; text: string; stageId?: string; timestamp?: string }>
  /** 屏 5：workflowCompleted.qualityReport */
  qualityReport?: QualityReportPayload | null
  /** instanceResumed 后聚焦的失败阶段 */
  focusFailedStageId?: string
  /** 产物落盘信号：递增即触发文件树重载（artifact/阶段完成/工作流完成/回滚时 bump）。 */
  fileTreeRevision: number
}

export const initialStagentState: StagentState = {
  phase: 'input',
  busy: null,
  blocked: false,
  blockReasons: [],
  warnings: [],
  tasks: [],
  stageStatus: {},
  streams: {},
  outputs: {},
  questionsBefore: {},
  questions: {},
  errors: {},
  confidence: {},
  artifacts: {},
  completed: false,
  engineActivityFeed: [],
  qualityReport: null,
  fileTreeRevision: 0,
}

type Action =
  | { kind: 'event'; msg: BackendMessage }
  | { kind: 'tasks'; tasks: TaskListItem[] }
  | { kind: 'reset' }
  | { kind: 'consumeWorkspacePath' }
  | { kind: 'selectTask'; instanceKey: string }

export function reduceStagentState(state: StagentState, action: Action): StagentState {
  if (action.kind === 'reset') {
    return { ...initialStagentState, tasks: state.tasks }
  }
  if (action.kind === 'tasks') {
    return { ...state, tasks: action.tasks }
  }
  if (action.kind === 'consumeWorkspacePath') {
    return { ...state, pickedWorkspacePath: undefined }
  }
  if (action.kind === 'selectTask') {
    return { ...state, activeInstanceKey: action.instanceKey }
  }

  const msg = action.msg
  switch (msg.type) {
    case 'loadTaskList':
      // 侧栏改用 listTaskItems()（含 instanceKey），此处仅作为刷新信号忽略 payload。
      return state
    case 'generationProgress':
      return { ...state, busy: { message: msg.message, detail: msg.detail }, failed: undefined }
    case 'polishSessionHint':
      return { ...state, polishHint: msg.message }
    case 'userTaskPolished':
      return {
        ...state,
        busy: null,
        polished: { text: msg.text, polishedAt: msg.polishedAt, fromCache: msg.fromCache },
        ...(msg.instanceKey
          ? { draftInstanceKey: msg.instanceKey, activeInstanceKey: msg.instanceKey }
          : {}),
      }
    case 'clarifyQuestions':
      return { ...state, phase: 'input', busy: null, clarify: msg.questions }
    case 'taskWorkspacePathPicked':
      return { ...state, pickedWorkspacePath: msg.path }
    case 'workflowGenerated':
      return {
        ...state,
        phase: 'confirm',
        busy: null,
        failed: undefined,
        workflow: msg.workflow,
        draftInstanceKey: msg.instanceKey,
        activeInstanceKey: msg.instanceKey ?? state.activeInstanceKey,
        blocked: msg.blocked ?? false,
        blockReasons: msg.blockReasons ?? [],
        warnings: msg.warningsDisplay ?? msg.warnings ?? [],
        planSummary: msg.planSummary ?? null,
        taskTypeClassification: msg.taskTypeClassification,
        decisionBoard: msg.decisionBoard,
      }
    case 'instanceResumed': {
      const stageStatus = msg.stageStatuses
        ? { ...msg.stageStatuses }
        : state.stageStatus
      let decisionStageId: string | undefined
      let pausedStageId: string | undefined
      if (msg.workflow?.stages && msg.stageStatuses) {
        for (const s of msg.workflow.stages) {
          const st = msg.stageStatuses[s.id]
          if (st === 'paused') {
            if (s.isDecisionStage) decisionStageId = s.id
            else pausedStageId = s.id
          }
        }
      }
      return {
        ...state,
        phase: 'execution',
        busy: null,
        workflow: msg.workflow,
        activeInstanceKey: msg.instanceKey,
        draftInstanceKey: msg.instanceKey,
        completed: msg.instanceStatus === 'completed',
        stageStatus,
        decisionStageId,
        pausedStageId,
        focusFailedStageId: msg.failedStageId,
        engineActivityFeed: msg.resync ? [] : state.engineActivityFeed,
        qualityReport: msg.resync ? null : state.qualityReport,
        errors: msg.resync ? {} : state.errors,
        failed:
          msg.instanceStatus === 'failed' && msg.failedSummary
            ? { reason: msg.failedSummary.error, errorType: msg.failedSummary.errorType }
            : msg.instanceStatus === 'failed'
              ? { reason: '工作流执行失败', errorType: 'unknown' }
              : undefined,
      }
    }
    case 'workflowFailed':
      return {
        ...state,
        busy: null,
        phase: 'execution',
        failed: { reason: msg.reason, errorType: msg.errorType },
        switchBlocked: undefined,
        ...(msg.stageId
          ? { stageStatus: { ...state.stageStatus, [msg.stageId]: 'error' } }
          : {}),
      }
    case 'instanceSwitchBlocked':
      return {
        ...state,
        switchBlocked: { reason: msg.reason, targetInstanceKey: msg.targetInstanceKey },
      }
    case 'stageStatusUpdate': {
      const stageStatus = { ...state.stageStatus, [msg.stageId]: msg.status }
      let decisionStageId = state.decisionStageId
      let pausedStageId = state.pausedStageId
      if (msg.status === 'paused') {
        if (msg.isDecisionStage) {
          decisionStageId = msg.stageId
        } else {
          pausedStageId = msg.stageId
        }
      } else {
        if (decisionStageId === msg.stageId) decisionStageId = undefined
        if (pausedStageId === msg.stageId) pausedStageId = undefined
      }
      return {
        ...state,
        phase: 'execution',
        stageStatus,
        decisionStageId,
        pausedStageId,
        // 阶段完成多半已把产物写盘 → 触发文件树重载。
        fileTreeRevision: msg.status === 'done' ? state.fileTreeRevision + 1 : state.fileTreeRevision,
      }
    }
    case 'streamChunk': {
      // 执行前的「润色 / 澄清 / 工作流生成」也走 streamChunk。这些增量不应把 UI 切到
      // execution 阶段，否则 input 视图下的润色结果 / 澄清表单永远不可见。
      const isPreExecTrace =
        msg.stageId === 'task-polish' ||
        msg.stageId.startsWith('clarify-questions') ||
        msg.stageId.startsWith('workflow-gen')
      return {
        ...state,
        ...(isPreExecTrace ? {} : { phase: 'execution' }),
        streams: { ...state.streams, [msg.stageId]: (state.streams[msg.stageId] ?? '') + msg.chunk },
      }
    }
    case 'stageOutputUpdate':
      return {
        ...state,
        outputs: {
          ...state.outputs,
          [msg.stageId]: { ...(state.outputs[msg.stageId] ?? {}), [msg.outputKey]: msg.content },
        },
      }
    case 'stageQuestionsBefore':
      return {
        ...state,
        phase: 'execution',
        questionsBefore: { ...state.questionsBefore, [msg.stageId]: msg.questions },
      }
    case 'stageQuestions':
      return {
        ...state,
        phase: 'execution',
        questions: { ...state.questions, [msg.stageId]: msg.questions },
      }
    case 'stageError':
      return {
        ...state,
        errors: {
          ...state.errors,
          [msg.stageId]: {
            error: msg.error,
            errorType: msg.errorType,
            stdout: msg.stdout,
            stderr: msg.stderr,
            userTitle: msg.userTitle,
            userBody: msg.userBody,
            playbookSteps: msg.playbookSteps,
          },
        },
      }
    case 'stageConfidenceUpdate':
      return {
        ...state,
        confidence: {
          ...state.confidence,
          [msg.stageId]: { score: msg.score, level: msg.level, reasons: msg.reasons },
        },
      }
    case 'stageArtifactHints':
      return {
        ...state,
        artifacts: { ...state.artifacts, [msg.stageId]: msg.artifacts },
        fileTreeRevision: state.fileTreeRevision + 1,
      }
    case 'downstreamReset': {
      const stageStatus = { ...state.stageStatus }
      const streams = { ...state.streams }
      const outputs = { ...state.outputs }
      for (const id of msg.resetStageIds) {
        stageStatus[id] = 'pending'
        delete streams[id]
        delete outputs[id]
      }
      return { ...state, stageStatus, streams, outputs, fileTreeRevision: state.fileTreeRevision + 1 }
    }
    case 'engineActivity': {
      const feed = [
        ...state.engineActivityFeed,
        { kind: msg.kind, text: msg.text, stageId: msg.stageId, timestamp: msg.timestamp },
      ].slice(-40)
      return { ...state, phase: 'execution', engineActivityFeed: feed }
    }
    case 'workflowCompleted':
      return {
        ...state,
        completed: true,
        qualityReport: msg.qualityReport ?? null,
        fileTreeRevision: state.fileTreeRevision + 1,
      }
    default:
      return state
  }
}

export interface StagentModelOption {
  id: string
  name: string
}

export interface StagentLlmConfig {
  llmApiKey: string
  llmBaseUrl: string
  llmModel: string
  llmMaxOutputTokens: number
  // M21 质量门 / 契约校验（键即点分配置键）
  'plan.requireCompleteness': boolean
  'tdd.redGreenGate': 'off' | 'warn' | 'hard'
  'hitl.pauseContractNodes': boolean
  'hitl.contractNodePauseThreshold': number
  'debug.requireFeedbackLoop': boolean
  'grill.adaptiveMode': boolean
  'glossary.enabled': boolean
  'architecture.depthScoring': boolean
  'skillNative.enabled': boolean
  'skillNative.skillsRoot': string
}

export interface StagentEngine {
  state: StagentState
  send: (msg: FrontendMessage) => Promise<{ ok: boolean; error?: string }>
  resume: (instanceKey: string) => Promise<{ ok: boolean; error?: string }>
  remove: (instanceKey: string, scope?: DeleteScope) => Promise<void>
  reset: () => void
  consumeWorkspacePath: () => void
  /** 侧栏点选任务：同步 activeInstanceKey，避免同工作区多实例误绑 */
  selectTask: (instanceKey: string) => void
  /** workflow.stages 的便捷访问（confirm/execution 共用） */
  stages: Stage[]
  /** LLM 提供方链可选模型（chain:auto / direct:* / local:*）。 */
  models: StagentModelOption[]
  /** 当前首选模型 family（空串表示用引擎默认 models[0]）。 */
  preferredModel: string
  setModel: (family: string) => Promise<void>
  /** 真实 API 配置读取 / 保存（保存后自动刷新模型链）。 */
  getConfig: () => Promise<StagentLlmConfig>
  saveConfig: (patch: Partial<StagentLlmConfig>) => Promise<void>
  /** 按需 AI 复核当前决策记录。 */
  reviewDecision: (
    stageId: string,
    decisionRecord: string,
  ) => Promise<{ ok: boolean; review?: string; model?: string; error?: string }>
}

import { shouldDropStaleMessage, type SeqGatedMessage } from './stagentSeqGate'

export function useStagentEngine(): StagentEngine {
  const [state, dispatch] = useReducer(reduceStagentState, initialStagentState)
  const [models, setModels] = useState<StagentModelOption[]>([])
  const [preferredModel, setPreferredModel] = useState('')
  const seqCursor = useRef({ lastSeq: 0, uiEpoch: 0 })

  const refreshControls = useCallback(() => {
    void window.autoAI.stagent
      .getControls()
      .then((c) => {
        setModels(c.models ?? [])
        setPreferredModel(c.preferredModel ?? '')
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const refreshTasks = (): void => {
      void window.autoAI.stagent
        .listTaskItems()
        .then((items) => dispatch({ kind: 'tasks', tasks: items as TaskListItem[] }))
        .catch(() => {})
    }
    const off = window.autoAI.stagent.onEvent((raw) => {
      const msg = raw as SeqGatedMessage
      if (shouldDropStaleMessage(msg, seqCursor.current)) {
        return
      }
      dispatch({ kind: 'event', msg })
    })
    const offTasks = window.autoAI.stagent.onTasksChanged(refreshTasks)
    // 与 VS Code webview 的 webviewReady 一致，并主动拉取侧栏任务项 + 模型链。
    void window.autoAI.stagent.send({ type: 'webviewReady' })
    refreshTasks()
    refreshControls()
    return () => {
      off()
      offTasks()
    }
  }, [refreshControls])

  const send = useCallback(
    (msg: FrontendMessage) => window.autoAI.stagent.send(msg),
    [],
  )
  const resume = useCallback(
    (instanceKey: string) => window.autoAI.stagent.resume(instanceKey),
    [],
  )
  const remove = useCallback(
    async (instanceKey: string, scope: DeleteScope = 'record') => {
      await window.autoAI.stagent.delete(instanceKey, scope)
    },
    [],
  )
  const reset = useCallback(() => {
    seqCursor.current = { lastSeq: 0, uiEpoch: 0 }
    dispatch({ kind: 'reset' })
  }, [])
  const consumeWorkspacePath = useCallback(() => dispatch({ kind: 'consumeWorkspacePath' }), [])
  const selectTask = useCallback(
    (instanceKey: string) => dispatch({ kind: 'selectTask', instanceKey }),
    [],
  )
  const setModel = useCallback(
    async (family: string) => {
      await window.autoAI.stagent.setModel(family)
      refreshControls()
    },
    [refreshControls],
  )
  const getConfig = useCallback(
    () => window.autoAI.stagent.getConfig() as Promise<StagentLlmConfig>,
    [],
  )
  const saveConfig = useCallback(
    async (patch: Partial<StagentLlmConfig>) => {
      await window.autoAI.stagent.setConfig(patch)
      refreshControls()
    },
    [refreshControls],
  )
  const reviewDecision = useCallback(
    (stageId: string, decisionRecord: string) =>
      window.autoAI.stagent.reviewDecision(stageId, decisionRecord),
    [],
  )

  return {
    state,
    send,
    resume,
    remove,
    reset,
    consumeWorkspacePath,
    selectTask,
    stages: state.workflow?.stages ?? [],
    models,
    preferredModel,
    setModel,
    getConfig,
    saveConfig,
    reviewDecision,
  }
}
