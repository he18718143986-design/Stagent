// ─── 工具类型 ───────────────────────────────────────────────────
export type ToolType = 'llm-text' | 'code-runner' | 'file-write' | 'file-read' | 'user-prompt';

// ─── ToolConfig（discriminated union） ─────────────────────────
/** `instance`：相对 `taskDir`（默认）；`workspace`：相对 `meta.taskWorkspacePath`（用户所选工作文件夹根，如已 npm init 的 `task/qr-app/`） */
export type ToolPathBase = 'instance' | 'workspace';

export interface LlmTextConfig {
  type: 'llm-text';
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
  /** 可选：将本阶段主输出写入指定相对路径文件（相对于 taskDir 或 workspace 根，取决于 writePathBase）；用于“实现 → 写文件 → 编译验证”链路。 */
  writeOutputToFile?: string;
  /** 写入根目录；默认 instance。workspace 时写入用户工作文件夹根下相对路径。 */
  writePathBase?: ToolPathBase;
}

export interface CodeRunnerConfig {
  type: 'code-runner';
  command: string;
  workingDir?: string;
  /** 命令 cwd 根目录；默认 instance（与历史行为一致）。workspace 时 cwd = 工作区根 + workingDir（默认 `.`） */
  pathBase?: ToolPathBase;
  timeout?: number; // 秒，默认 60
  captureOutput: boolean;
  /**
   * B-Q1 有界运行：command 为长驻进程（如 `npm start`）时设为 true，
   * 引擎以「后台起 → 探活/grace → 进程组 kill」方式有界执行（spawnBoundedServe），
   * 避免长驻进程卡住执行器。仅 smoke/e2e 阶段使用；缺省 false = 历史行为。
   */
  serve?: boolean;
  /** serve=true 时的探活命令（shell，exit 0 即就绪）；未设则用 graceMs 存活探测。 */
  readyProbe?: string;
  /** serve=true 无 readyProbe 时：进程需稳定存活这么久才算通过（ms）。 */
  graceMs?: number;
  /** serve=true 探活轮询上限（ms）。 */
  readyTimeoutMs?: number;
}

export interface FileWriteConfig {
  type: 'file-write';
  filePath: string;
  sourceOutputKey: string;
  /** 从指定阶段的运行时读取 sourceOutputKey；未设置时按 key 在 stages 中首次命中（向后兼容） */
  sourceStageId?: string;
  /** 落盘根目录；默认 instance。workspace 时写入用户工作文件夹根下相对路径 */
  pathBase?: ToolPathBase;
}

export interface FileReadConfig {
  type: 'file-read';
  filePath: string;
}

export interface UserPromptConfig {
  type: 'user-prompt';
  promptText: string;
  inputLabel: string;
}

export type ToolConfig =
  | LlmTextConfig
  | CodeRunnerConfig
  | FileWriteConfig
  | FileReadConfig
  | UserPromptConfig;

// ─── StageOutput ───────────────────────────────────────────────
export interface StageOutput {
  key: string;
  format: 'text' | 'markdown' | 'json' | 'file-path';
  description?: string;
}

// ─── SkipCondition ─────────────────────────────────────────────
export interface SkipCondition {
  type:
    | 'exitCodeZero'
    | 'exitCodeNonZero'
    | 'stageSkipped'
    | 'stageSkippedOrExitCodeZero'
    | 'anyTestRunFailed';
  stageId: string;
  outputKey?: string; // 默认 '_exitCode'
}

// ─── ErrorHandling ─────────────────────────────────────────────
export interface ErrorHandling {
  strategy: 'retry' | 'fail' | 'pause' | 'skip';
  maxRetries?: number; // strategy='retry' 时有效，默认 3
  escalateAfterRetries?: boolean; // 默认 true（超限后切换为 'pause'）
}

// ─── StageInput ────────────────────────────────────────────────
export type InputContextMode = 'full' | 'summary' | 'reference';

export interface InputSource {
  type: 'stage-output' | 'user-input' | 'human-answer' | 'human-answer-before' | 'constant' | 'file';
  stageId?: string;
  outputKey?: string;
  questionId?: string;
  filePath?: string;
  value?: string;
  label?: string;
  /** type=file 时读取根目录；默认 instance（taskDir），workspace 对齐 meta.taskWorkspacePath */
  pathBase?: ToolPathBase;
  /** 显式上下文压缩（对齐 ai-workflow contextMode）；未设时由引擎按 token 自动降级 */
  contextMode?: InputContextMode;
  /** 默认 true；resolveInput 可扩展消费 */
  required?: boolean;
}

export interface StageInput {
  sources: InputSource[];
  mergeStrategy: 'concat' | 'template' | 'object';
  mergeTemplate?: string;
}

// ─── Question ──────────────────────────────────────────────────
export interface Question {
  id: string;
  text: string;
  hint?: string;
  required?: boolean; // 默认 true
  /** stageQuestionsBefore 出站 enrich；不属于持久化 workflow JSON */
  suggestedAnswer?: string;
  provenance?: import('../charter/CharterTypes').DecisionProvenance;
  ruleRefs?: number[];
}

// ─── Stage ─────────────────────────────────────────────────────
export interface Stage {
  id: string;
  title: string;
  description?: string;
  /** 确认页只读：本阶段审核重点 / 常见失败提示（生成器可选填写） */
  aiTip?: string;
  tool: ToolType;
  toolConfig: ToolConfig;
  input: StageInput;
  outputs: StageOutput[];
  pauseAfter: boolean;
  isDecisionStage?: boolean;
  exposeAssumptions?: boolean;
  /** 工具执行前追问；见 SPEC-v2 §4.1 / 任务清单 M7 */
  questionBefore?: Question[];
  questionAfter?: Question[];
  patchMode?: boolean;
  skipIf?: SkipCondition;
  onError?: ErrorHandling;
  /** 前置 stage id 列表；若声明则每一项必须存在于 workflow 且在本阶段之前（§7.8.3 / SPEC §4.1）。是否按 DAG 执行由 globalConfig.enableDagScheduler 决定。 */
  dependsOn?: string[];
  /** Contract-First：确定性步骤（venv/conftest/verify）跳过 confidence HITL pause。 */
  meta?: { executionMode?: 'deterministic' };
}
