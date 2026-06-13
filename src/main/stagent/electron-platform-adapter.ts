/* ------------------------------------------------------------------ */
/*  electron-platform-adapter.ts — PlatformAdapter 的 Electron 实现      */
/*                                                                     */
/*  把「vscode.* → PlatformAdapter」9 类能力映射到 Electron + Node：     */
/*    config/state → userData/stagent 下的 JSON 文件                    */
/*    paths        → app.getPath('userData')                           */
/*    ui           → webContents.send / 内部 incoming 分发              */
/*    notify       → dialog.showMessageBox                             */
/*    dialog       → dialog.showOpenDialog                             */
/*    editor       → shell.openPath（diff 落临时文件后打开）            */
/*    shell        → shell.openExternal / clipboard.writeText          */
/*    llm          → 提供方链：真实 API 优先，:8787 本地适配器降级       */
/*                                                                     */
/*  WorkflowEngine 注入本实现即可在 Electron 宿主运行，引擎代码零改动。 */
/* ------------------------------------------------------------------ */

import { BrowserWindow, clipboard, dialog, shell } from 'electron'
import { promises as fsp } from 'node:fs'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type {
  ConfigPort,
  DialogPort,
  EditorPort,
  LlmModel,
  LlmPort,
  NotifyPort,
  PathsPort,
  PlatformAdapter,
  ShellPort,
  StatePort,
  UiBridgePort,
} from '@stagent/core'
import { OpenAiHttpLlmModel } from './openai-llm'
import { LocalAdapterLlmModel, ProviderChainLlmModel, QuotaCooldownRegistry } from './provider-chain'

/** 本地 OpenAI 兼容适配器信息（来自 startLocalAdapterServer().getInfo()）。 */
export interface LocalAdapterInfo {
  enabled: boolean
  url: string
}

/** 极简同步 JSON KV 存储：懒加载到内存，set 立即写盘。 */
class JsonKvStore {
  private cache: Record<string, unknown> | undefined

  constructor(private readonly file: string) {}

  private load(): Record<string, unknown> {
    if (this.cache) {
      return this.cache
    }
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      this.cache = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
      this.cache = {}
    }
    return this.cache
  }

  get<T>(key: string): T | undefined {
    const v = this.load()[key]
    return v === undefined ? undefined : (v as T)
  }

  set<T>(key: string, value: T | undefined): void {
    const data = this.load()
    if (value === undefined) {
      delete data[key]
    } else {
      data[key] = value
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(data, null, 2), 'utf8')
    } catch {
      /* 写盘失败不致命：内存值仍有效，下次重试 */
    }
  }

  keys(): readonly string[] {
    return Object.keys(this.load())
  }
}

class ElectronConfigPort implements ConfigPort {
  constructor(private readonly store: JsonKvStore) {}
  get<T>(key: string, defaultValue: T): T
  get<T>(key: string): T | undefined
  get<T>(key: string, defaultValue?: T): T | undefined {
    const v = this.store.get<T>(key)
    return v === undefined ? defaultValue : v
  }
}

class ElectronStatePort implements StatePort {
  constructor(private readonly store: JsonKvStore) {}
  get<T>(key: string): T | undefined {
    return this.store.get<T>(key)
  }
  set<T>(key: string, value: T | undefined): void {
    this.store.set(key, value)
  }
  keys(): readonly string[] {
    return this.store.keys()
  }
}

class ElectronPathsPort implements PathsPort {
  constructor(
    private readonly storageDir: string,
    private readonly getWorkspaceRoot: () => string | undefined,
  ) {}
  globalStorageDir(): string {
    fs.mkdirSync(this.storageDir, { recursive: true })
    return this.storageDir
  }
  workspaceRoot(): string | undefined {
    return this.getWorkspaceRoot()
  }
}

/**
 * UI 桥：send 推送 BackendMessage 到渲染进程；onMessage 供引擎订阅（由
 * stagent-ipc 在收到渲染进程消息时调用 dispatchIncoming 转发）。
 */
export class ElectronUiBridgePort implements UiBridgePort {
  private readonly handlers = new Set<(msg: unknown) => void>()

  constructor(private readonly getWebContents: () => Electron.WebContents | undefined) {}

  send(msg: unknown): void {
    const wc = this.getWebContents()
    if (wc && !wc.isDestroyed()) {
      wc.send('stagent:event', msg)
    }
  }

  onMessage(handler: (msg: unknown) => void): { dispose(): void } {
    this.handlers.add(handler)
    return { dispose: () => this.handlers.delete(handler) }
  }

  /** stagent-ipc 收到渲染进程消息时调用，转发给所有订阅者。 */
  dispatchIncoming(msg: unknown): void {
    for (const h of this.handlers) {
      h(msg)
    }
  }
}

class ElectronNotifyPort implements NotifyPort {
  constructor(private readonly getWindow: () => BrowserWindow | undefined) {}

  private async show(
    type: 'info' | 'warning' | 'error',
    message: string,
    actions: string[],
  ): Promise<string | undefined> {
    const buttons = actions.length > 0 ? actions : ['确定']
    const win = this.getWindow()
    const opts: Electron.MessageBoxOptions = { type, message, buttons, noLink: true }
    const result = win
      ? await dialog.showMessageBox(win, opts)
      : await dialog.showMessageBox(opts)
    if (actions.length === 0) {
      return undefined
    }
    return actions[result.response]
  }

  info(message: string, ...actions: string[]): Promise<string | undefined> {
    return this.show('info', message, actions)
  }
  warn(message: string, ...actions: string[]): Promise<string | undefined> {
    return this.show('warning', message, actions)
  }
  error(message: string, ...actions: string[]): Promise<string | undefined> {
    return this.show('error', message, actions)
  }
}

class ElectronDialogPort implements DialogPort {
  constructor(private readonly getWindow: () => BrowserWindow | undefined) {}
  async pickDirectory(options?: { title?: string }): Promise<string | undefined> {
    const win = this.getWindow()
    const opts: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: options?.title,
    }
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) {
      return undefined
    }
    return result.filePaths[0]
  }
}

class ElectronEditorPort implements EditorPort {
  async openFile(absPath: string): Promise<void> {
    const err = await shell.openPath(absPath)
    if (err) {
      throw new Error(`无法打开文件：${err}`)
    }
  }

  async openDiff(
    left: { content: string; ext?: string },
    right: { content: string; ext?: string },
    title: string,
  ): Promise<void> {
    // Electron 无内建 diff 视图：将两侧落临时文件后用系统默认程序打开。
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'stagent-diff-'))
    const safeTitle = title.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'diff'
    const leftPath = path.join(dir, `${safeTitle}.base${left.ext ?? '.txt'}`)
    const rightPath = path.join(dir, `${safeTitle}.current${right.ext ?? '.txt'}`)
    await fsp.writeFile(leftPath, left.content, 'utf8')
    await fsp.writeFile(rightPath, right.content, 'utf8')
    await shell.openPath(rightPath)
    await shell.openPath(leftPath)
  }
}

class ElectronShellPort implements ShellPort {
  async openExternal(url: string): Promise<void> {
    await shell.openExternal(url)
  }
  async copyText(text: string): Promise<void> {
    clipboard.writeText(text)
  }
}

/**
 * 模型选择 / LLM 提供方链（s5）：真实 API 优先，:8787 本地适配器降级。
 *
 * listModels 返回顺序（首项即 models[0]，引擎默认使用）：
 *   1. `chain:auto` 复合模型（仅当存在 ≥2 个委托时）——真实 API 优先、本地降级；
 *   2. 真实 API 模型 `direct:<model>`（配置了 llmApiKey 时）；
 *   3. 各本地浏览器站点 `local:<modelId>`（:8787 /v1/models 可达时）。
 *
 * 按 filter.family 精确返回；`direct:` 走快路径（不查本地，避免热路径网络延迟）。
 */
class ElectronLlmPort implements LlmPort {
  /** #3：配额冷却注册表，跨多次 listModels()/sendRequest() 调用存活。 */
  private readonly cooldown: QuotaCooldownRegistry

  constructor(
    private readonly config: ConfigPort,
    private readonly getLocalAdapterInfo: () => LocalAdapterInfo,
  ) {
    const ttlMs = this.config.get<number>('llmQuotaCooldownMs', 60_000)
    this.cooldown = new QuotaCooldownRegistry(ttlMs)
  }

  async listModels(filter?: { family?: string }): Promise<LlmModel[]> {
    const family = filter?.family?.trim()
    const realApi = this.buildRealApiModel()

    // 已固定真实 API：直接返回，省去本地枚举的网络往返。
    if (family && family.startsWith('direct:')) {
      return realApi ? [realApi] : []
    }

    const locals = await this.fetchLocalModels()
    const all = this.assembleChain(realApi, locals)
    if (family) {
      return all.filter((m) => m.family === family)
    }
    return all
  }

  /** 真实 OpenAI 兼容 HTTP 模型；未配置 llmApiKey 时返回 undefined。 */
  private buildRealApiModel(): OpenAiHttpLlmModel | undefined {
    const apiKey = (this.config.get<string>('llmApiKey', '') ?? '').trim()
    if (!apiKey) {
      return undefined
    }
    const baseUrl = this.config.get<string>('llmBaseUrl', 'https://api.openai.com/v1')
    const model = this.config.get<string>('llmModel', 'gpt-4o')
    const maxOutputTokens = this.config.get<number>('llmMaxOutputTokens', 16384)
    return new OpenAiHttpLlmModel({ apiKey, baseUrl, model, maxOutputTokens })
  }

  /** 查询本地适配器 /v1/models，映射为 LocalAdapterLlmModel；不可达时返回 []。 */
  private async fetchLocalModels(): Promise<LocalAdapterLlmModel[]> {
    const info = this.getLocalAdapterInfo()
    if (!info.enabled || !info.url) {
      return []
    }
    try {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 1500)
      const res = await fetch(`${info.url}/v1/models`, { signal: ac.signal }).finally(() =>
        clearTimeout(timer),
      )
      if (!res.ok) {
        return []
      }
      const body = (await res.json()) as {
        data?: Array<{ id?: string; metadata?: { label?: string } }>
      }
      const list = Array.isArray(body.data) ? body.data : []
      return list
        .filter((m): m is { id: string; metadata?: { label?: string } } => typeof m.id === 'string')
        .map((m) => new LocalAdapterLlmModel(info.url, m.id, m.metadata?.label ?? m.id))
    } catch {
      return []
    }
  }

  private assembleChain(
    realApi: OpenAiHttpLlmModel | undefined,
    locals: LocalAdapterLlmModel[],
  ): LlmModel[] {
    const delegates: LlmModel[] = [...(realApi ? [realApi] : []), ...locals]
    const out: LlmModel[] = []
    // ≥2 个提供方时提供「自动降级」复合模型作为首选（带配额冷却失败转移）。
    if (delegates.length >= 2) {
      out.push(new ProviderChainLlmModel(delegates, this.cooldown))
    }
    if (realApi) {
      out.push(realApi)
    }
    out.push(...locals)
    return out
  }
}

export interface ElectronPlatformAdapterDeps {
  /** app.getPath('userData') */
  userDataDir: string
  /** 当前主窗口（用于对话框 / webContents 推送）；可随窗口重建而变化。 */
  getWindow: () => BrowserWindow | undefined
  /** 本地 OpenAI 兼容适配器信息（:8787 降级）；缺省视为未启用。 */
  getLocalAdapterInfo?: () => LocalAdapterInfo
}

/** Stagent LLM 配置（真实 API 档）。 */
export interface StagentLlmConfig {
  llmApiKey: string
  llmBaseUrl: string
  llmModel: string
  llmMaxOutputTokens: number
  // M21 质量门 / 契约校验（键即 ConfigPort 读取用的点分键，读时有默认值）
  'plan.requireCompleteness': boolean
  'tdd.redGreenGate': 'off' | 'warn' | 'hard'
  'hitl.pauseContractNodes': boolean
  'hitl.contractNodePauseThreshold': number
  'debug.requireFeedbackLoop': boolean
  'grill.adaptiveMode': boolean
  'glossary.enabled': boolean
  'architecture.depthScoring': boolean
  // S3：skill-native 编排（调用原版 SKILL.md）。默认关闭。
  'skillNative.enabled': boolean
  'skillNative.skillsRoot': string
}

/** PlatformAdapter 的 Electron 聚合实现。 */
export class ElectronPlatformAdapter implements PlatformAdapter {
  readonly config: ConfigPort
  readonly state: StatePort
  readonly paths: PathsPort
  readonly ui: ElectronUiBridgePort
  readonly notify: NotifyPort
  readonly dialog: DialogPort
  readonly editor: EditorPort
  readonly shell: ShellPort
  readonly llm: LlmPort

  /** 与 ElectronConfigPort 共享同一实例，写入后读取立即可见。 */
  private readonly configStore: JsonKvStore

  constructor(deps: ElectronPlatformAdapterDeps) {
    const storageDir = path.join(deps.userDataDir, 'stagent')
    const configStore = new JsonKvStore(path.join(storageDir, 'config.json'))
    const stateStore = new JsonKvStore(path.join(storageDir, 'state.json'))
    this.configStore = configStore

    this.config = new ElectronConfigPort(configStore)
    this.state = new ElectronStatePort(stateStore)
    this.paths = new ElectronPathsPort(storageDir, () =>
      this.config.get<string>('taskWorkspacePath'),
    )
    this.ui = new ElectronUiBridgePort(() => {
      const win = deps.getWindow()
      return win && !win.isDestroyed() ? win.webContents : undefined
    })
    this.notify = new ElectronNotifyPort(deps.getWindow)
    this.dialog = new ElectronDialogPort(deps.getWindow)
    this.editor = new ElectronEditorPort()
    this.shell = new ElectronShellPort()
    this.llm = new ElectronLlmPort(
      this.config,
      deps.getLocalAdapterInfo ?? (() => ({ enabled: false, url: '' })),
    )
  }

  /** 读取真实 API 配置（供设置面板回显；apiKey 原样返回，本地桌面应用语境）。 */
  getLlmConfig(): StagentLlmConfig {
    return {
      llmApiKey: this.config.get<string>('llmApiKey', ''),
      llmBaseUrl: this.config.get<string>('llmBaseUrl', 'https://api.openai.com/v1'),
      llmModel: this.config.get<string>('llmModel', 'gpt-4o'),
      llmMaxOutputTokens: this.config.get<number>('llmMaxOutputTokens', 16384),
      // M21 质量门：默认值与 stagent-core 的 read* 读取默认保持一致
      'plan.requireCompleteness': this.config.get<boolean>('plan.requireCompleteness', true),
      'tdd.redGreenGate': this.config.get<'off' | 'warn' | 'hard'>('tdd.redGreenGate', 'warn'),
      'hitl.pauseContractNodes': this.config.get<boolean>('hitl.pauseContractNodes', true),
      'hitl.contractNodePauseThreshold': this.config.get<number>('hitl.contractNodePauseThreshold', 0.75),
      'debug.requireFeedbackLoop': this.config.get<boolean>('debug.requireFeedbackLoop', true),
      'grill.adaptiveMode': this.config.get<boolean>('grill.adaptiveMode', false),
      'glossary.enabled': this.config.get<boolean>('glossary.enabled', true),
      'architecture.depthScoring': this.config.get<boolean>('architecture.depthScoring', false),
      'skillNative.enabled': this.config.get<boolean>('skillNative.enabled', false),
      'skillNative.skillsRoot': this.config.get<string>('skillNative.skillsRoot', ''),
    }
  }

  /** 写入真实 API 配置（仅落已提供字段）。listModels 每次现读 config，改后即时生效。 */
  setLlmConfig(patch: Partial<StagentLlmConfig>): void {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined && value !== null) {
        this.configStore.set(key, value)
      }
    }
  }
}
