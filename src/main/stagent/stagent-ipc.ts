/* ------------------------------------------------------------------ */
/*  stagent-ipc.ts — 把 @stagent/core 的 WorkflowEngine 接到 Electron IPC  */
/*                                                                     */
/*  等价于 VS Code 扩展的 extension.ts：构造引擎 + ElectronPlatformAdapter， */
/*  注册 ipcMain handlers，把渲染进程的 FrontendMessage 分发到引擎方法，  */
/*  引擎产生的 BackendMessage 经 adapter.ui → 'stagent:event' 推回渲染层。 */
/* ------------------------------------------------------------------ */

import { BrowserWindow, ipcMain } from 'electron'
import log from 'electron-log'
import {
  WorkflowEngine,
  isFrontendMessage,
  type FrontendMessage,
  type LlmMessage,
} from '@stagent/core'
import {
  ElectronPlatformAdapter,
  type LocalAdapterInfo,
  type StagentLlmConfig,
} from './electron-platform-adapter'
import {
  buildFileTree,
  readTextFile,
  writeTextFile,
  registerAllowedRoot,
} from './workspace-fs'

/** 本模块注册的全部 IPC channel（供 main 的 unregister 复用）。 */
export const STAGENT_IPC_CHANNELS = [
  'stagent:send',
  'stagent:list-tasks',
  'stagent:list-task-items',
  'stagent:recoverable',
  'stagent:resume',
  'stagent:delete',
  'stagent:prune',
  'stagent:get-controls',
  'stagent:set-model',
  'stagent:get-config',
  'stagent:set-config',
  'stagent:review-decision',
  'stagent:fs-tree',
  'stagent:fs-read',
  'stagent:fs-write',
] as const

interface StagentRuntime {
  engine: WorkflowEngine
  adapter: ElectronPlatformAdapter
}

interface DecisionReviewContext {
  instanceTitle: string
  taskType?: string
  userInput?: string
  stageTitle: string
  stageDescription?: string
  upstreamDecisions: { stageId: string; summary: string }[]
}

/**
 * 「AI 复核」prompt：让模型贴着本阶段语义对决策记录挑刺（语义判断），
 * 与前端 6 条正则结构自检互补。要求简短可执行、不重写代码、不打分。
 */
function buildDecisionReviewPrompt(
  decisionRecord: string,
  ctx: DecisionReviewContext | undefined,
): string {
  const lines: string[] = []
  lines.push(
    '你是严格的资深技术评审。请针对下面这条「决策记录」做批判性复核，指出薄弱处与可执行的改进建议。',
    '要求：用中文，总长 ≤ 400 字；不要重写或生成代码；不要给分数；每条以「✅」或「⚠️」开头，一行一条。',
    '',
  )
  if (ctx) {
    lines.push(`任务：${ctx.instanceTitle}${ctx.taskType ? `（类型：${ctx.taskType}）` : ''}`)
    if (ctx.userInput?.trim()) {
      lines.push(`用户目标：${ctx.userInput.trim().slice(0, 300)}`)
    }
    lines.push(`当前决策阶段：${ctx.stageTitle}`)
    if (ctx.stageDescription?.trim()) {
      lines.push(`阶段说明：${ctx.stageDescription.trim().slice(0, 300)}`)
    }
    if (ctx.upstreamDecisions.length > 0) {
      lines.push('已批准的上游决策（节选，注意是否冲突）：')
      for (const d of ctx.upstreamDecisions) {
        lines.push(`- [${d.stageId}] ${d.summary}`)
      }
    }
    lines.push('')
  }
  lines.push(
    '决策记录：',
    '"""',
    decisionRecord.trim(),
    '"""',
    '',
    '请重点评估：',
    '1. 备选方案：是否真说明了「为什么不选」，理由是否站得住、贴合本阶段目标？',
    '2. 边界压力测试：场景是否具体、有代表性（避免雷同/凑数）？',
    '3. AI 无法验证的假设：是否确属无法自动验证、需人确认的？有无遗漏？',
    '4. 是否混入了实现代码（决策记录只应讲决策与取舍）？',
    '5. 若涉及已有代码：冲突检测是否标注清楚、与上游决策是否一致？',
  )
  return lines.join('\n')
}

let runtime: StagentRuntime | undefined

function getRuntime(
  getWindow: () => BrowserWindow | undefined,
  userDataDir: string,
  getLocalAdapterInfo: () => LocalAdapterInfo,
): StagentRuntime {
  if (runtime) {
    return runtime
  }
  const adapter = new ElectronPlatformAdapter({ userDataDir, getWindow, getLocalAdapterInfo })
  const engine = new WorkflowEngine(adapter)
  engine.setInstancesChangedListener(() => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('stagent:tasks-changed')
    }
  })
  runtime = { engine, adapter }
  // 启动时清理过期的全局实例（与扩展侧 activate 一致）。
  try {
    engine.pruneStaleGlobalInstances()
  } catch (err) {
    log.warn('stagent: pruneStaleGlobalInstances failed', { err: String(err) })
  }
  return runtime
}

/**
 * 分发一条渲染进程发来的 FrontendMessage 到引擎方法。
 * 镜像 extension.ts 的 wirePanelHandlers switch。
 */
async function dispatchFrontendMessage(rt: StagentRuntime, m: FrontendMessage): Promise<void> {
  const { engine, adapter } = rt
  switch (m.type) {
    case 'webviewReady':
      adapter.ui.send({ type: 'loadTaskList', instances: engine.getTaskSummaries() })
      break
    case 'pickTaskWorkspaceFolder': {
      const picked = await adapter.dialog.pickDirectory({ title: '选择工作文件夹' })
      if (picked) {
        adapter.ui.send({ type: 'taskWorkspacePathPicked', path: picked })
      }
      break
    }
    case 'polishUserTask':
      await engine.polishUserTask(m.draft, m.taskType ?? 'auto', m.taskWorkspacePath?.trim())
      break
    case 'clarifyStart': {
      const tw = m.taskWorkspacePath
      if (typeof tw !== 'string' || !tw.trim()) {
        await adapter.notify.error('Stagent：请填写「工作文件夹」路径。')
        break
      }
      await engine.generateClarifyQuestions(m.userInput, m.taskType ?? 'auto', tw.trim())
      break
    }
    case 'generateWorkflow': {
      const tw = m.taskWorkspacePath
      if (typeof tw !== 'string' || !tw.trim()) {
        await adapter.notify.error('Stagent：请填写「工作文件夹」路径。')
        break
      }
      await engine.generateWorkflow(
        m.userInput,
        m.taskType ?? 'auto',
        tw.trim(),
        m.polishContext,
        m.clarifyAnswers,
      )
      break
    }
    case 'startExecution':
      await engine.startExecution(m.workflow, m.instanceKey)
      break
    case 'approve':
      await engine.approve(m.stageId)
      break
    case 'approveDecision':
      await engine.approveDecision(m.stageId, m.decisionRecord)
      break
    case 'answerQuestionsBefore':
      await engine.answerQuestionsBefore(m.stageId, m.answers)
      break
    case 'answerQuestions':
      await engine.answerQuestions(m.stageId, m.answers)
      break
    case 'retry':
      await engine.retry(m.stageId, m.comment)
      break
    case 'copyDebugLog':
      await engine.copyRecentDebugLog()
      break
    case 'copySessionLog':
      await engine.copyRecentDebugLog()
      break
    case 'editOutput':
      engine.editOutput(m.stageId, m.outputKey, m.newContent)
      break
    case 'openArtifactFile':
      await engine.openArtifactFile(m.stageId, m.filePath)
      break
    case 'openArtifactDiff':
      await engine.openArtifactDiff(m.stageId, m.filePath)
      break
    default:
      break
  }
}

/**
 * 注册 Stagent 相关 IPC。幂等：重复调用会先移除旧 handler。
 * @param getWindow 当前主窗口访问器（窗口可能在 macOS Dock 重新激活时重建）
 * @param userDataDir app.getPath('userData')
 */
export function registerStagentIpc(
  getWindow: () => BrowserWindow | undefined,
  userDataDir: string,
  getLocalAdapterInfo: () => LocalAdapterInfo = () => ({ enabled: false, url: '' }),
): void {
  for (const ch of STAGENT_IPC_CHANNELS) {
    ipcMain.removeHandler(ch)
  }

  const rt = getRuntime(getWindow, userDataDir, getLocalAdapterInfo)
  const { engine, adapter } = rt

  ipcMain.handle('stagent:send', async (_e, msg: unknown) => {
    if (!isFrontendMessage(msg)) {
      return { ok: false, error: 'invalid-frontend-message' }
    }
    try {
      await dispatchFrontendMessage(rt, msg as FrontendMessage)
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('stagent:send failed', { type: (msg as FrontendMessage).type, error: message })
      return { ok: false, error: message }
    }
  })

  ipcMain.handle('stagent:list-tasks', () => engine.getTaskSummaries())
  ipcMain.handle('stagent:list-task-items', () => engine.getTaskListItems())
  ipcMain.handle('stagent:recoverable', () => engine.getRecoverableInstanceKeys())

  ipcMain.handle('stagent:resume', async (_e, instanceKey: unknown) => {
    if (typeof instanceKey !== 'string') {
      return { ok: false, error: 'invalid-instance-key' }
    }
    try {
      const result = await engine.resumeInstance(instanceKey)
      return result
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('stagent:delete', (_e, instanceKey: unknown, scope: unknown) => {
    if (typeof instanceKey !== 'string') {
      return { ok: false, error: 'invalid-instance-key' }
    }
    const s = scope === 'artifacts' || scope === 'folder' ? scope : 'record'
    engine.deleteInstance(instanceKey, s)
    return { ok: true }
  })

  ipcMain.handle('stagent:prune', () => {
    engine.pruneStaleGlobalInstances()
    return { ok: true }
  })

  ipcMain.handle('stagent:get-controls', async () => {
    const models = await adapter.llm.listModels()
    return {
      models: models.map((m) => ({ id: m.family, name: m.name })),
      preferredModel: engine.getPreferredModelFamily(),
      stageInfo: engine.getCurrentStageInfo() ?? null,
    }
  })

  ipcMain.handle('stagent:set-model', (_e, modelFamily: unknown) => {
    if (typeof modelFamily !== 'string') {
      return { ok: false, error: 'invalid-model-family' }
    }
    engine.setPreferredModelFamily(modelFamily)
    return { ok: true }
  })

  // ── 工作目录文件浏览器：树读取 + 文本读写（VS Code 式左树 + 中央编辑器） ──
  ipcMain.handle('stagent:fs-tree', (_e, rootPath: unknown) => {
    if (typeof rootPath !== 'string' || !rootPath.trim()) {
      return { ok: false, error: 'invalid-root' }
    }
    try {
      registerAllowedRoot(rootPath.trim())
      return { ok: true, tree: buildFileTree(rootPath.trim()) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('stagent:fs-read', (_e, filePath: unknown) => {
    if (typeof filePath !== 'string') {
      return { ok: false, error: 'invalid-path' }
    }
    return readTextFile(filePath)
  })

  ipcMain.handle('stagent:fs-write', (_e, filePath: unknown, content: unknown) => {
    if (typeof filePath !== 'string') {
      return { ok: false, error: 'invalid-path' }
    }
    return writeTextFile(filePath, typeof content === 'string' ? content : String(content ?? ''))
  })

  ipcMain.handle('stagent:get-config', () => adapter.getLlmConfig())

  ipcMain.handle('stagent:set-config', (_e, patch: unknown) => {
    if (!patch || typeof patch !== 'object') {
      return { ok: false, error: 'invalid-config' }
    }
    adapter.setLlmConfig(patch as Partial<StagentLlmConfig>)
    return { ok: true }
  })

  ipcMain.handle('stagent:review-decision', async (_e, payload: unknown) => {
    const p = payload as { stageId?: unknown; decisionRecord?: unknown } | null
    const stageId = typeof p?.stageId === 'string' ? p.stageId : ''
    const decisionRecord = typeof p?.decisionRecord === 'string' ? p.decisionRecord : ''
    if (!decisionRecord.trim()) {
      return { ok: false, error: 'empty-decision' }
    }
    const models = await adapter.llm.listModels()
    const preferred = engine.getPreferredModelFamily()
    const model = models.find((m) => m.family === preferred) ?? models[0]
    if (!model) {
      return { ok: false, error: 'no-model' }
    }
    const ctx = stageId ? engine.getDecisionReviewContext(stageId) : undefined
    const messages: LlmMessage[] = [
      { role: 'user', content: buildDecisionReviewPrompt(decisionRecord, ctx) },
    ]
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 120_000)
    try {
      let out = ''
      for await (const frag of model.sendRequest(messages, { maxTokens: 800 }, ac.signal)) {
        out += frag
      }
      return { ok: true, review: out.trim(), model: model.name }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      clearTimeout(timer)
    }
  })

  log.info('stagent IPC registered')
}
