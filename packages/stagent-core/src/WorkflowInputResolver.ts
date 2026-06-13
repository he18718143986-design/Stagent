/**
 * M35 / #1：阶段输入合并与降级（从 `WorkflowEngine.resolveInput` 抽出）。
 * 引擎注入文件读取、摘要 LLM、日志与 Webview 消息回调。
 */
import type { BackendMessage, InputSource, Stage, StageRuntime, WorkflowDefinition } from './WorkflowDefinition';
import {
  applyInputTruncationPolicy,
  buildResolveInputEntries,
  mergeResolvedInputEntries,
} from './InputTruncationPolicy';
import { contentOfSource, resolveInputSourceContent } from './InputSourceStrategies';

export { contentOfSource, resolveInputSourceContent };

export {
  DEFAULT_STAGE_INPUT_TOTAL_LIMIT_TOKENS,
  DEFAULT_STAGE_INPUT_TRUNCATE_TOKENS,
} from './InputTokenBudgets';
import {
  DEFAULT_STAGE_INPUT_TOTAL_LIMIT_TOKENS,
  DEFAULT_STAGE_INPUT_TRUNCATE_TOKENS,
} from './InputTokenBudgets';

export interface InputResolverContext {
  definition: WorkflowDefinition;
  stageRuntimes: StageRuntime[];
  taskDir?: string;
  workspaceRoot?: string;
}

export interface InputResolverDeps {
  readFileText: (absPath: string) => string | Promise<string>;
  fileExists: (absPath: string) => boolean | Promise<boolean>;
  safeJoinUnderWorkspaceRoot: (root: string, relativePath: string) => string;
  warn: (message: string) => void;
  debugLog: (stageId: string, event: string, attempt: number, payload?: unknown) => void;
  summarizeForInput: (stageId: string, label: string, raw: string) => Promise<string>;
  postMessage: (msg: BackendMessage) => void;
  onContextOverflow?: (
    stage: Stage,
    runtime: StageRuntime,
    totalTokens: number,
    totalLimit: number,
  ) => void;
  /** 输入上下文降级回调（供 MetricsCollector 计数 + token delta 观测）。 */
  recordContextDegrade?: (info: {
    stageId: string;
    label: string;
    fromTokens: number;
    toTokens: number;
    to: 'summary' | 'reference';
  }) => void;
  truncateTokens?: number;
  totalTokenLimit?: number;
}

/** 合并 stage.input.sources 并按 InputContextPolicy 降级（与引擎原 `resolveInput` 等价）。 */
export async function resolveStageInput(
  ctx: InputResolverContext,
  stage: Stage,
  runtime: StageRuntime,
  deps: InputResolverDeps,
): Promise<string> {
  const truncateTokens = deps.truncateTokens ?? DEFAULT_STAGE_INPUT_TRUNCATE_TOKENS;
  const totalLimit = deps.totalTokenLimit ?? DEFAULT_STAGE_INPUT_TOTAL_LIMIT_TOKENS;

  const entries = await buildResolveInputEntries(ctx, stage, runtime, deps, truncateTokens);
  const truncated = await applyInputTruncationPolicy(entries, stage, runtime, deps, totalLimit);
  return mergeResolvedInputEntries(stage, truncated, deps);
}
