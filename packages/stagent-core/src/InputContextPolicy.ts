import type { InputSource } from './WorkflowDefinition';
import { STAGENT_GLOBAL_DECISIONS_LABEL } from './GlobalDecisionContext';

/** 与 WorkflowEngine.resolveInput 总上下文上限一致 */
export const DEFAULT_CONTEXT_TOTAL_TOKEN_LIMIT = 60_000;
export const DEFAULT_RESERVED_FOR_OUTPUT_TOKENS = 8_000;
/** M16 CodebaseContextProvider 注入上限（§8.3 保守默认） */
export const DEFAULT_CODEBASE_CONTEXT_MAX_TOKENS = 4_000;
export const DEFAULT_USER_INPUT_MAX_TOKENS = 8_000;
export const DEFAULT_GLOBAL_DECISION_CONTEXT_MAX_TOKENS = 16_000;

/** M16 占位：generateWorkflow 代码库快照块 label */
export const STAGENT_CODEBASE_SNAPSHOT_LABEL = '_stagent_codebase_snapshot';

/** stage-output 输入在 resolveInput 中的降级角色 */
export type InputSourceRole = 'decision-record' | 'implementation' | 'default';

export type ContextBudgetCategory =
  | 'decision-record'
  | 'global-decision'
  | 'user-input'
  | 'stage-output'
  | 'codebase-snapshot'
  | 'other';

export interface ContextBudget {
  totalTokenLimit: number;
  reservedForOutput: number;
  availableForInput: number;
  decisionContextMax: number;
  globalDecisionContextMax: number;
  codebaseContextMax: number;
  userInputMax: number;
  stageOutputPool: number;
}

export interface ContextBudgetRequest {
  category: ContextBudgetCategory;
  requestedTokens: number;
  /** 对应 sources[] 下标；codebase 占位为 -1 */
  sourceIndex: number;
}

export interface ContextBudgetAllocation extends ContextBudgetRequest {
  grantedTokens: number;
}

export interface AllocateContextBudgetOptions {
  reservedForOutput?: number;
  /** M16.1 前可先 true 参与预算竞争 */
  includeCodebaseSnapshot?: boolean;
  codebaseSnapshotTokens?: number;
  /** 与 sources 等长；缺省视为 0 */
  sourceTokenCounts?: number[];
}

export interface AllocateContextBudgetResult {
  budget: ContextBudget;
  allocations: ContextBudgetAllocation[];
}

export type InputDegradeMode = 'full' | 'summary' | 'reference';

export interface InputDegradeThresholds {
  fullMax: number;
  summaryMax: number;
  /** 总上下文超限时，优先保留 full/summary，最后再降级此类条目 */
  preserveOnTotalOverflow: boolean;
}

/** 普通 stage-output（实现代码、日志等）：较早 summary */
export const INPUT_THRESHOLDS_DEFAULT: InputDegradeThresholds = {
  fullMax: 500,
  summaryMax: 3000,
  preserveOnTotalOverflow: false,
};

/** decisionRecord 与全局决策注入块：尽量保留全文 */
export const INPUT_THRESHOLDS_DECISION_RECORD: InputDegradeThresholds = {
  fullMax: 8000,
  summaryMax: 16000,
  preserveOnTotalOverflow: true,
};

/** 实现类输出（测试/源码）：略高阈值；总上下文超限时优先保留 */
export const INPUT_THRESHOLDS_IMPLEMENTATION: InputDegradeThresholds = {
  fullMax: 1500,
  summaryMax: 6000,
  preserveOnTotalOverflow: true,
};

const IMPLEMENTATION_OUTPUT_KEYS = new Set([
  'testCode',
  'implementationCode',
  'sourceCode',
  'fileContent',
  'bindVideoTs',
  'indexPage',
  'packageJson',
]);

export function thresholdsForRole(role: InputSourceRole): InputDegradeThresholds {
  switch (role) {
    case 'decision-record':
      return INPUT_THRESHOLDS_DECISION_RECORD;
    case 'implementation':
      return INPUT_THRESHOLDS_IMPLEMENTATION;
    default:
      return INPUT_THRESHOLDS_DEFAULT;
  }
}

/** 按 outputKey / 来源 stageId 对 stage-output 分级，决定 full / summary / reference 阈值 */
export function classifyStageOutputSource(source: InputSource): InputSourceRole {
  if (source.type !== 'stage-output') {
    return 'default';
  }
  if (source.outputKey === 'decisionRecord') {
    return 'decision-record';
  }
  if (source.stageId && /^stage_impl_/.test(source.stageId)) {
    return 'implementation';
  }
  if (source.outputKey && IMPLEMENTATION_OUTPUT_KEYS.has(source.outputKey)) {
    return 'implementation';
  }
  return 'default';
}

/** M20.3：源上显式 contextMode 覆盖自动降级计划 */
export function resolveExplicitContextDegradeMode(
  source: InputSource,
  tokenCount: number,
  role: InputSourceRole,
): InputDegradeMode | undefined {
  const mode = source.contextMode;
  if (!mode) {
    return undefined;
  }
  const { summaryMax } = thresholdsForRole(role);
  if (mode === 'full') {
    return 'full';
  }
  if (mode === 'reference') {
    return 'reference';
  }
  if (mode === 'summary') {
    return tokenCount <= summaryMax ? 'full' : 'summary';
  }
  return undefined;
}

export function planInputDegradeMode(tokenCount: number, role: InputSourceRole): InputDegradeMode {
  const { fullMax, summaryMax } = thresholdsForRole(role);
  if (tokenCount <= fullMax) {
    return 'full';
  }
  if (tokenCount <= summaryMax) {
    return 'summary';
  }
  return 'reference';
}

/** 总上下文超限时，选择下一个应降级的条目（非 preserve 优先，同组内 token 大者优先） */
export function pickEntryIndexToDegrade(
  entries: Array<{ mode: InputDegradeMode; preservePriority: boolean; tokenCount: number }>,
): number {
  let best = -1;
  let bestPreserve = true;
  let bestTokens = -1;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.mode === 'reference') {
      continue;
    }
    const preserve = e.preservePriority;
    const tokens = e.tokenCount;
    if (best < 0) {
      best = i;
      bestPreserve = preserve;
      bestTokens = tokens;
      continue;
    }
    if (bestPreserve && !preserve) {
      best = i;
      bestPreserve = preserve;
      bestTokens = tokens;
      continue;
    }
    if (bestPreserve === preserve && tokens > bestTokens) {
      best = i;
      bestTokens = tokens;
    }
  }
  return best;
}

const BUDGET_PRIORITY: Record<ContextBudgetCategory, number> = {
  'decision-record': 50,
  'global-decision': 40,
  'user-input': 30,
  'stage-output': 20,
  other: 15,
  'codebase-snapshot': 5,
};

function isCodebaseSnapshotSource(source: InputSource): boolean {
  return source.label === STAGENT_CODEBASE_SNAPSHOT_LABEL;
}

export function classifyInputSourceBudgetCategory(source: InputSource): ContextBudgetCategory {
  if (isCodebaseSnapshotSource(source)) {
    return 'codebase-snapshot';
  }
  if (source.type === 'user-input') {
    return 'user-input';
  }
  if (source.type === 'stage-output') {
    if (source.outputKey === 'decisionRecord') {
      return 'decision-record';
    }
    if (source.label === STAGENT_GLOBAL_DECISIONS_LABEL) {
      return 'global-decision';
    }
    return 'stage-output';
  }
  return 'other';
}

function categoryCap(budget: ContextBudget, category: ContextBudgetCategory): number {
  switch (category) {
    case 'decision-record':
      return budget.decisionContextMax;
    case 'global-decision':
      return budget.globalDecisionContextMax;
    case 'codebase-snapshot':
      return budget.codebaseContextMax;
    case 'user-input':
      return budget.userInputMax;
    case 'stage-output':
    case 'other':
      return budget.stageOutputPool;
    default:
      return budget.stageOutputPool;
  }
}

function buildContextBudgetSkeleton(
  totalLimit: number,
  reservedForOutput: number,
): ContextBudget {
  const availableForInput = Math.max(0, totalLimit - reservedForOutput);
  const decisionContextMax = Math.min(
    INPUT_THRESHOLDS_DECISION_RECORD.summaryMax,
    Math.floor(availableForInput * 0.35),
  );
  const globalDecisionContextMax = Math.min(
    DEFAULT_GLOBAL_DECISION_CONTEXT_MAX_TOKENS,
    Math.floor(availableForInput * 0.25),
  );
  const codebaseContextMax = Math.min(
    DEFAULT_CODEBASE_CONTEXT_MAX_TOKENS,
    Math.floor(availableForInput * 0.1),
  );
  const userInputMax = Math.min(DEFAULT_USER_INPUT_MAX_TOKENS, Math.floor(availableForInput * 0.15));
  const stageOutputPool = Math.max(
    0,
    availableForInput -
      decisionContextMax -
      globalDecisionContextMax -
      codebaseContextMax -
      userInputMax,
  );
  return {
    totalTokenLimit: totalLimit,
    reservedForOutput,
    availableForInput,
    decisionContextMax,
    globalDecisionContextMax,
    codebaseContextMax,
    userInputMax,
    stageOutputPool,
  };
}

function buildContextBudgetRequests(
  sources: InputSource[],
  options?: Pick<AllocateContextBudgetOptions, 'includeCodebaseSnapshot' | 'codebaseSnapshotTokens' | 'sourceTokenCounts'>,
): ContextBudgetRequest[] {
  const tokenCounts = options?.sourceTokenCounts ?? [];
  const requests: ContextBudgetRequest[] = sources.map((source, index) => ({
    category: classifyInputSourceBudgetCategory(source),
    requestedTokens: tokenCounts[index] ?? 0,
    sourceIndex: index,
  }));
  if (options?.includeCodebaseSnapshot) {
    requests.push({
      category: 'codebase-snapshot',
      requestedTokens: options.codebaseSnapshotTokens ?? DEFAULT_CODEBASE_CONTEXT_MAX_TOKENS,
      sourceIndex: -1,
    });
  }
  return requests;
}

/**
 * 在总 token 预算内按优先级分配：decisionRecord / 全局决策 > user-input > stage-output > codebase 快照。
 * 纯函数；`estimateTokens` 由调用方在外部估算后传入 `sourceTokenCounts`。
 */
export function allocateContextBudget(
  sources: InputSource[],
  totalLimit: number = DEFAULT_CONTEXT_TOTAL_TOKEN_LIMIT,
  options?: AllocateContextBudgetOptions,
): AllocateContextBudgetResult {
  const reservedForOutput = options?.reservedForOutput ?? DEFAULT_RESERVED_FOR_OUTPUT_TOKENS;
  const budget = buildContextBudgetSkeleton(totalLimit, reservedForOutput);
  const requests = buildContextBudgetRequests(sources, options);

  const allocations: ContextBudgetAllocation[] = requests.map((req) => ({
    ...req,
    grantedTokens: Math.min(req.requestedTokens, categoryCap(budget, req.category)),
  }));

  const totalGranted = allocations.reduce((sum, a) => sum + a.grantedTokens, 0);
  if (totalGranted <= budget.availableForInput) {
    return { budget, allocations };
  }

  let overflow = totalGranted - budget.availableForInput;
  const indices = allocations
    .map((_, i) => i)
    .sort((a, b) => BUDGET_PRIORITY[allocations[a].category] - BUDGET_PRIORITY[allocations[b].category]);

  for (const idx of indices) {
    if (overflow <= 0) {
      break;
    }
    const cur = allocations[idx];
    if (cur.grantedTokens <= 0) {
      continue;
    }
    const reduce = Math.min(cur.grantedTokens, overflow);
    cur.grantedTokens -= reduce;
    overflow -= reduce;
  }

  return { budget, allocations };
}

/** 将文本截断到不超过 maxTokens（字符估算 tokens≈length/4） */
export function truncateTextToTokenBudget(text: string, maxTokens: number): string {
  if (maxTokens <= 0) {
    return '';
  }
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n\n[内容已截断以符合上下文 token 预算]`;
}
