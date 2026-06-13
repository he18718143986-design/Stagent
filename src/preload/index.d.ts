/* ------------------------------------------------------------------ */
/*  src/preload/index.d.ts — TypeScript declaration for window.autoAI  */
/* ------------------------------------------------------------------ */

// ─── Core data types ────────────────────────────────────────────────────────

export type OutputType = 'text' | 'image' | 'video'

export interface SelectorStrategy {
  selector: string
  method: 'css' | 'text' | 'role' | 'testid' | 'xpath'
  priority: number
  lastWorked?: string
  failCount: number
}

export type SelectorChain = SelectorStrategy[]

/** M11: Metadata for a single selectable AI model (see §2.9) */
export interface ModelOption {
  id: string       // e.g. 'gpt-4o'
  label: string    // Display name, e.g. 'GPT-4o'
  selector?: string  // CSS selector for the option element inside the model dropdown
}

/** M12: A one-click composer tool (深度思考 / 联网搜索 …) — see site-store.ts. */
export interface ToolToggle {
  id: string
  label: string
  selector: string
  menuTriggerSelector?: string
}

/** M13: A reasoning-effort tier (e.g. Claude Effort Low/Medium/High/Max) — see site-store.ts. */
export interface EffortLevel {
  id: string
  label: string
  selector?: string
}

export interface SiteConfig {
  siteId: string
  hostname: string
  label: string
  url: string
  outputType: OutputType
  inputSelectors: SelectorChain
  sendSelectors: SelectorChain
  responseSelectors: SelectorChain
  quotaExhaustedIndicator?: string
  fileUploadTrigger?: string
  /** M11: Selector for the button that opens the model picker dropdown. Empty = no model switching. */
  modelSwitcherSelector?: string
  /** M11: Known available models for this account (from presets; manual editing TBD). */
  availableModels?: ModelOption[]
  /** M11: Currently selected model ID (e.g. 'gpt-4o'). undefined = use the AI site's default. */
  activeModel?: string
  /** M12: One-click composer tools (深度思考 / 联网搜索 …). */
  toolToggles?: ToolToggle[]
  /** M12: Tool ids currently turned ON (re-applied before task-execution sends). */
  activeTools?: string[]
  /** M13: Reasoning-effort tiers (e.g. Claude Effort Low/Medium/High/Max). */
  effortLevels?: EffortLevel[]
  /** M13: Submenu trigger (inside the model picker) that reveals the effort tiers. */
  effortMenuTriggerSelector?: string
  /** M13: Currently selected effort tier id. */
  activeEffort?: string
  calibrated: boolean
  addedAt: number
}

export type SiteStatus = 'connected' | 'disconnected' | 'quota-exhausted' | 'loading'

export type RuntimeIssueCategory =
  | 'render-crash'
  | 'webcontents-destroyed'
  | 'network-fail'
  | 'chat-interrupted'

export interface SiteRuntimeEvent {
  siteId: string
  category: RuntimeIssueCategory
  reason: string
  recovery: 'auto-recreate' | 'manual-check'
  failureCount: number
  ts: number
}

export interface RuntimeRecoveryPolicy {
  windowMs: number
  autoRecoverThreshold: number
}

export interface RuntimeCategoryStats {
  count: number
  lastReason?: string
  lastAt?: number
}

export interface SiteRuntimeStats {
  siteId: string
  total: number
  recentInWindow: number
  byCategory: Record<RuntimeIssueCategory, RuntimeCategoryStats>
}

export interface RuntimeStatsSnapshot {
  policy: RuntimeRecoveryPolicy
  totals: Record<RuntimeIssueCategory, number>
  bySite: Record<string, SiteRuntimeStats>
}

export interface NetworkDiagnostics {
  checkedAt: number
  proxyConfigured: boolean
  layers: Array<{
    layer: 'app' | 'session' | 'backend'
    status: 'ok' | 'warn' | 'fail'
    detail: string
  }>
}

/** Last chat automation failure — diagnostics panel */
export interface ChatFailureRecord {
  sendSeq?: string
  siteId: string
  hostname: string
  kind:
    | 'timeout'
    | 'certificate-proxy'
    | 'proxy-mismatch'
    | 'navigation-interrupt'
    | 'playwright-cdp'
    | 'inject'
    | 'unknown'
  code?: string
  stage?: 'send' | 'inject' | 'network' | 'dom' | 'settle' | 'repair'
  detail: string
  retryable?: boolean
  automationPath: 'playwright' | 'legacy'
  ts: number
}

export interface AutomationMetricsSnapshot {
  started: number
  succeeded: number
  timedOut: number
  recoveredByAutoRepair: number
  bySite: Record<string, { started: number; succeeded: number; timedOut: number }>
}

export interface SiteWithStatus extends SiteConfig {
  status: SiteStatus
}

export interface AutomationResult {
  outputType: OutputType
  quotaExhausted?: boolean
  text?: string
  imageUrls?: string[]
  videoUrl?: string
}

export interface SelectorFields {
  inputSelectors?: SelectorChain
  sendSelectors?: SelectorChain
  responseSelectors?: SelectorChain
  quotaExhaustedIndicator?: string
  fileUploadTrigger?: string
}

// ─── API shape ───────────────────────────────────────────────────────────────

export interface AutoAIAPI {
  ping(): Promise<string>

  site: {
    add(url: string, label?: string): Promise<SiteConfig>
    remove(siteId: string): Promise<void>
    list(): Promise<SiteWithStatus[]>
    openLogin(siteId: string): Promise<void>
    closeLogin(siteId: string): Promise<void>
    closeAllLogins(): Promise<void>
    updateSelectors(siteId: string, fields: SelectorFields): Promise<void>
    checkQuota(siteId: string): Promise<{ cleared?: boolean; error?: string }>
    /** Rename a site's display label. */
    rename(siteId: string, label: string): Promise<{ ok: true }>
    /** Show the real AI website in a WebContentsView below the tab bar. */
    showView(siteId: string): Promise<{ ok: true }>
    /** Hide the website view, returning to the React chat UI. */
    hideView(siteId: string): Promise<{ ok: true }>
    /** Listen for login success pushed from main process. Returns unsubscribe fn. */
    onLoginSuccess(cb: (payload: { siteId: string }) => void): () => void
    /** Listen for any site status change pushed from main process. */
    onStatusChanged(cb: (payload: { siteId: string; status: SiteStatus }) => void): () => void
    /** Listen for runtime crash/network issue events from main process. */
    onRuntimeEvent(cb: (payload: SiteRuntimeEvent) => void): () => void
    /** Read current runtime recovery policy. */
    getRuntimePolicy(): Promise<RuntimeRecoveryPolicy>
    /** Update runtime recovery policy (partial patch). */
    setRuntimePolicy(patch: Partial<RuntimeRecoveryPolicy>): Promise<RuntimeRecoveryPolicy>
    /** Read aggregated runtime issue stats (all sites or one site). */
    getRuntimeStats(siteId?: string): Promise<RuntimeStatsSnapshot>
    /** Clear aggregated runtime issue stats (all sites or one site). */
    clearRuntimeStats(siteId?: string): Promise<{ ok: true }>
    /** Read startup / last-refresh proxy consistency diagnostics (app/session/backend). */
    getNetworkDiagnostics(): Promise<NetworkDiagnostics | null>
    /** Re-run proxy consistency check (same logic as startup). */
    refreshNetworkDiagnostics(): Promise<NetworkDiagnostics | null>
    /** Last chat send failure snapshot for stability troubleshooting */
    getLastChatFailure(): Promise<ChatFailureRecord | null>
    /** Recent failure snapshots for CI/runtime diagnosis panels */
    listRecentChatFailures(limit?: number): Promise<ChatFailureRecord[]>
    clearChatFailures(): Promise<{ ok: true }>
    getAutomationMetrics(): Promise<AutomationMetricsSnapshot>
    resetAutomationMetrics(): Promise<{ ok: true }>
  }

  chat: {
    send(siteId: string, text: string): Promise<{ error?: string }>
    onReply(cb: (payload: { siteId: string; result: AutomationResult }) => void): () => void
    onQuotaExhausted(cb: (siteId: string) => void): () => void
    /** M11: Switch the AI site to a different model. Equivalent to starting a new conversation. */
    switchModel(siteId: string, modelId: string): Promise<{ ok?: true; modelLabel?: string; error?: string }>
    /** M11: List the available models and currently active model for a site. */
    listModels(siteId: string): Promise<{ models: ModelOption[]; activeModel?: string; error?: string }>
    /** M12: List the one-click tools and which are currently ON. */
    listTools(siteId: string): Promise<{ tools: ToolToggle[]; activeTools: string[]; error?: string }>
    /** M12: Toggle a composer tool on/off (omit `enable` for a pure flip). */
    toggleTool(
      siteId: string,
      toolId: string,
      enable?: boolean,
    ): Promise<{ ok?: true; toolId?: string; enabled?: boolean; state?: boolean | null; activeTools?: string[]; error?: string }>
  }

  calibrate: {
    start(siteId: string): Promise<void>
    cancel(siteId: string): Promise<void>
    onDone(cb: (siteId: string) => void): () => void
    onStep(cb: (data: { step: 1 | 2; instruction: string }) => void): () => void
    onNeeded(cb: (payload: { siteId: string }) => void): () => void
  }
  adapter: {
    getInfo(): Promise<{ enabled: boolean; url: string }>
  }

  /**
   * Stagent 决策式工作流引擎（@stagent/core，主进程经 ElectronPlatformAdapter 运行）。
   * 消息体沿用 core 的 FrontendMessage / BackendMessage（此处按 unknown 透传，
   * 渲染层在 s4 收敛具体类型）。
   */
  stagent: {
    /** 发送一条 FrontendMessage（如 generateWorkflow / approve / retry …）。 */
    send(msg: unknown): Promise<{ ok: boolean; error?: string }>
    /** 任务摘要列表（loadTaskList 用）。 */
    listTasks(): Promise<unknown[]>
    /** 侧栏任务列表项。 */
    listTaskItems(): Promise<unknown[]>
    /** 可恢复实例 key 列表。 */
    recoverable(): Promise<string[]>
    /** 恢复指定实例。 */
    resume(instanceKey: string): Promise<{ ok: boolean; error?: string }>
    /** 删除指定实例。scope：record=仅记录 / artifacts=含新建产物 / folder=含整个工作文件夹。 */
    delete(
      instanceKey: string,
      scope?: 'record' | 'artifacts' | 'folder',
    ): Promise<{ ok: boolean; error?: string }>
    /** 清理过期全局实例。 */
    prune(): Promise<{ ok: true }>
    /** AI 控制面板状态：可用模型 / 首选模型 / 当前阶段。 */
    getControls(): Promise<{
      models: Array<{ id: string; name: string }>
      preferredModel: string
      stageInfo: unknown
    }>
    /** 设置首选模型 family。 */
    setModel(modelFamily: string): Promise<{ ok: boolean; error?: string }>
    /** 读取真实 API 配置（设置面板回显）。 */
    getConfig(): Promise<{
      llmApiKey: string
      llmBaseUrl: string
      llmModel: string
      llmMaxOutputTokens: number
    }>
    /** 写入真实 API 配置（仅落已提供字段）。 */
    setConfig(patch: {
      llmApiKey?: string
      llmBaseUrl?: string
      llmModel?: string
      llmMaxOutputTokens?: number
    }): Promise<{ ok: boolean; error?: string }>
    /** 按需 AI 复核：把决策记录 + 阶段上下文发给 LLM，返回批判性点评。 */
    reviewDecision(
      stageId: string,
      decisionRecord: string,
    ): Promise<{ ok: boolean; review?: string; model?: string; error?: string }>
    /** 订阅引擎推送的 BackendMessage。返回取消订阅函数。 */
    onEvent(cb: (msg: unknown) => void): () => void
    /** 订阅任务列表变更通知（持久化/删除时触发）。 */
    onTasksChanged(cb: () => void): () => void
    /** 读取工作目录的真实文件树（用于左侧文件浏览器）。 */
    fsTree(rootPath: string): Promise<{ ok: boolean; tree?: FsTreeNode; error?: string }>
    /** 读取单个文本文件内容。 */
    fsRead(filePath: string): Promise<{ ok: boolean; content?: string; error?: string }>
    /** 写回单个文本文件内容。 */
    fsWrite(filePath: string, content: string): Promise<{ ok: boolean; error?: string }>
  }
}

/** 文件树节点（与主进程 workspace-fs.ts 的 FsNode 对应）。 */
export interface FsTreeNode {
  name: string
  path: string
  type: 'dir' | 'file'
  children?: FsTreeNode[]
}

// ─── Global window augmentation ─────────────────────────────────────────────

declare global {
  interface Window {
    autoAI: AutoAIAPI
  }
}
