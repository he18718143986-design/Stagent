/**
 * 总上下文 token 预算分配（按类别上限 + 优先级削减）—从 InputContextPolicy.ts 抽出（1.3）。
 * 纯函数；token 估算由调用方在外部完成后以 sourceTokenCounts 传入。
 */
import {
  CONTEXT_BUDGET_CODEBASE_RATIO,
  CONTEXT_BUDGET_DECISION_RECORD_RATIO,
  CONTEXT_BUDGET_GLOBAL_DECISION_RATIO,
  CONTEXT_BUDGET_USER_INPUT_RATIO,
  DEFAULT_CODEBASE_CONTEXT_MAX_TOKENS,
  DEFAULT_CONTEXT_TOTAL_TOKEN_LIMIT,
  DEFAULT_GLOBAL_DECISION_CONTEXT_MAX_TOKENS,
  DEFAULT_RESERVED_FOR_OUTPUT_TOKENS,
  DEFAULT_USER_INPUT_MAX_TOKENS,
} from '../InputTokenBudgets';
import { PRIMARY_DECISION_OUTPUT_KEY } from '../WorkflowOutputKeys';
import type { InputSource } from '../WorkflowDefinition';
import { STAGENT_GLOBAL_DECISIONS_LABEL } from '../GlobalDecisionContext';
import {
  INPUT_BUDGET_PRIORITY_CODEBASE_SNAPSHOT,
  INPUT_BUDGET_PRIORITY_DECISION_RECORD,
  INPUT_BUDGET_PRIORITY_GLOBAL_DECISION,
  INPUT_BUDGET_PRIORITY_OTHER,
  INPUT_BUDGET_PRIORITY_STAGE_OUTPUT,
  INPUT_BUDGET_PRIORITY_USER_INPUT,
} from '../InputContextBudgetPriorities';
import { INPUT_THRESHOLDS_DECISION_RECORD } from './degradePolicy';

/** M16 占位：generateWorkflow 代码库快照块 label */
export const STAGENT_CODEBASE_SNAPSHOT_LABEL = '_stagent_codebase_snapshot';

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

const BUDGET_PRIORITY: Record<ContextBudgetCategory, number> = {
  'decision-record': INPUT_BUDGET_PRIORITY_DECISION_RECORD,
  'global-decision': INPUT_BUDGET_PRIORITY_GLOBAL_DECISION,
  'user-input': INPUT_BUDGET_PRIORITY_USER_INPUT,
  'stage-output': INPUT_BUDGET_PRIORITY_STAGE_OUTPUT,
  other: INPUT_BUDGET_PRIORITY_OTHER,
  'codebase-snapshot': INPUT_BUDGET_PRIORITY_CODEBASE_SNAPSHOT,
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
    if (source.outputKey === PRIMARY_DECISION_OUTPUT_KEY) {
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
    Math.floor(availableForInput * CONTEXT_BUDGET_DECISION_RECORD_RATIO),
  );
  const globalDecisionContextMax = Math.min(
    DEFAULT_GLOBAL_DECISION_CONTEXT_MAX_TOKENS,
    Math.floor(availableForInput * CONTEXT_BUDGET_GLOBAL_DECISION_RATIO),
  );
  const codebaseContextMax = Math.min(
    DEFAULT_CODEBASE_CONTEXT_MAX_TOKENS,
    Math.floor(availableForInput * CONTEXT_BUDGET_CODEBASE_RATIO),
  );
  const userInputMax = Math.min(
    DEFAULT_USER_INPUT_MAX_TOKENS,
    Math.floor(availableForInput * CONTEXT_BUDGET_USER_INPUT_RATIO),
  );
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
