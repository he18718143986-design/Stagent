import type { FrontendMessage, Stage } from '@stagent/core'
import type { StagentState, StagentLlmConfig } from '../useStagentEngine'

export interface CockpitFormState {
  draft: string
  setDraft: (v: string) => void
  taskType: string
  setTaskType: (v: string) => void
  workspacePath: string
  setWorkspacePath: (v: string) => void
}

export interface CockpitEngineSlice {
  state: StagentState
  stages: Stage[]
  models: Array<{ id: string; name: string; provider?: string }>
  preferredModel: string
  setModel: (id: string) => Promise<void>
  getConfig: () => Promise<StagentLlmConfig>
  saveConfig: (patch: Partial<StagentLlmConfig>) => Promise<void>
  reviewDecision: (
    stageId: string,
    decisionRecord: string,
  ) => Promise<{ ok: boolean; review?: string; model?: string; error?: string }>
}

export interface CockpitScreenProps {
  engine: CockpitEngineSlice
  form: CockpitFormState
  onNewTask: () => void
  send: (msg: FrontendMessage) => Promise<void>
  /** 简单模式屏0：无工作区时先选文件夹再 clarify */
  onStartClarifyFlow?: () => void
  /** 澄清请求进行中（LLM 未返回前） */
  clarifyPending?: boolean
}

export const SUGGESTION_CHIPS = [
  { label: '记账小工具', emoji: '📒' },
  { label: '待办清单', emoji: '✅' },
  { label: '成绩统计', emoji: '📊' },
] as const

export const TASK_TYPES = [
  { value: 'auto', label: '自动判定' },
  { value: 'software', label: '软件开发' },
  { value: 'document', label: '文档写作' },
  { value: 'video', label: '视频脚本' },
  { value: 'debug', label: '调试排错' },
  { value: 'general', label: '通用' },
] as const
