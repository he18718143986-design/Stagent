/* ------------------------------------------------------------------ */
/*  PlatformAdapter — 平台无关的宿主能力契约                            */
/*                                                                     */
/*  目的：让 WorkflowEngine 及 130+ 纯模块只依赖本接口，不再直接调用    */
/*  `vscode.*`。VS Code 内由 VscodePlatformAdapter 实现；后续独立化后   */
/*  由 ElectronPlatformAdapter 实现（autoAI main 进程）。               */
/*                                                                     */
/*  端口划分对应「vscode.* → PlatformAdapter」映射表的 9 类能力。       */
/* ------------------------------------------------------------------ */

/** 平台无关的对话消息（替代 vscode.LanguageModelChatMessage） */
export interface LlmMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** 单次调用选项（替代 vscode.LanguageModelChatRequestOptions.modelOptions） */
export interface LlmSendOptions {
  maxTokens?: number;
  temperature?: number;
  /**
   * 要求模型产出严格 JSON 对象（#2 治本）。支持的真实 API（OpenAI 兼容）会下发
   * `response_format: { type: 'json_object' }`；不支持的提供方（浏览器网页 AI）忽略即可。
   * 仅用于「期望 JSON 对象」的调用（generateWorkflow / clarify）；决策记录等分节文本不要开启。
   */
  jsonMode?: boolean;
  /**
   * 流式存活回调：每当底层收到「任何」服务端流量（正文增量、推理 / 思维链
   * `reasoning_content` 增量、SSE keepalive 等）时调用一次。调用方据此实现
   * 「空闲超时」——只要连接还在吐字节就不判定卡死。这修复了推理模型在长
   * 思考阶段只发 `reasoning_content`、不发 `content`，导致空闲计时器误杀的问题。
   */
  onActivity?: () => void;
}

/**
 * 平台无关的语言模型（替代 vscode.LanguageModelChat）。
 * `sendRequest` 直接返回文本增量异步流，调用方逐块消费（替代 response.text）。
 */
export interface LlmModel {
  readonly id: string;
  readonly family: string;
  readonly name: string;
  /**
   * 是否可靠产出结构化（严格 JSON / 受参数约束）输出。
   * - `true` / `undefined`：可靠（真实 API、Copilot 等）；undefined 视为可靠以保持向后兼容。
   * - `false`：不可靠（如浏览器自动化网页 AI，会包 markdown / 截断 / 无 temperature）。
   *
   * 引擎据此做「能力路由」：generateWorkflow / 决策 / JSON 阶段优先选可靠模型，
   * 仅当首选模型 `structuredOutput === false` 时才覆盖为链路中的可靠模型。
   */
  readonly structuredOutput?: boolean;
  sendRequest(
    messages: LlmMessage[],
    options: LlmSendOptions | undefined,
    signal: AbortSignal,
  ): AsyncIterable<string>;
}

/** 表 1：配置读取（替代 vscode.workspace.getConfiguration('stagent').get） */
export interface ConfigPort {
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string): T | undefined;
}

/** 表 2/3：KV 持久化（替代 context.globalState.get/update/keys） */
export interface StatePort {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T | undefined): void;
  keys(): readonly string[];
}

/** 表 4/5：路径解析（替代 globalStorageUri.fsPath / workspaceFolders） */
export interface PathsPort {
  /** 全局存储目录（失败日志、任务状态等的根） */
  globalStorageDir(): string;
  /** 当前工作区根；独立化后为用户选定的任务工作目录 */
  workspaceRoot(): string | undefined;
}

/**
 * 表 6/7：与前端的消息桥（替代 webview.postMessage / onDidReceiveMessage）。
 * 引擎只管收发结构化消息；VS Code 侧绑定 WebviewPanel，Electron 侧走 IPC。
 */
export interface UiBridgePort {
  send(msg: unknown): void;
  onMessage(handler: (msg: unknown) => void): { dispose(): void };
}

/** 表 8/9/10：通知与可操作弹窗（替代 window.show{Error,Warning,Information}Message） */
export interface NotifyPort {
  info(message: string, ...actions: string[]): Promise<string | undefined>;
  warn(message: string, ...actions: string[]): Promise<string | undefined>;
  error(message: string, ...actions: string[]): Promise<string | undefined>;
}

/** 表 11：文件夹选择（替代 window.showOpenDialog） */
export interface DialogPort {
  pickDirectory(options?: { title?: string }): Promise<string | undefined>;
}

/** 表 12/13：打开文件 / diff（替代 openTextDocument + showTextDocument / vscode.diff） */
export interface EditorPort {
  openFile(absPath: string): Promise<void>;
  openDiff(
    left: { content: string; ext?: string },
    right: { content: string; ext?: string },
    title: string,
  ): Promise<void>;
}

/** 表 16/17/18：外部链接与剪贴板（替代 env.openExternal / env.clipboard） */
export interface ShellPort {
  openExternal(url: string): Promise<void>;
  copyText(text: string): Promise<void>;
}

/** 表 21~24：模型选择与调用（替代 vscode.lm.selectChatModels + LanguageModelChat） */
export interface LlmPort {
  /** 按优先级返回可用模型；列表第一个为首选。空数组表示无可用模型。 */
  listModels(filter?: { family?: string }): Promise<LlmModel[]>;
}

/** 聚合 9 个端口的宿主适配器。 */
export interface PlatformAdapter {
  readonly config: ConfigPort;
  readonly state: StatePort;
  readonly paths: PathsPort;
  readonly ui: UiBridgePort;
  readonly notify: NotifyPort;
  readonly dialog: DialogPort;
  readonly editor: EditorPort;
  readonly shell: ShellPort;
  readonly llm: LlmPort;
}
