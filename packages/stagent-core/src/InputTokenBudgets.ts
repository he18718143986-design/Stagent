/** 阶段输入 / 全局上下文 token 预算（与 WorkflowInputResolver、InputContextPolicy 对齐）。 */
export const DEFAULT_STAGE_INPUT_TRUNCATE_TOKENS = 3000;
export const DEFAULT_STAGE_INPUT_TOTAL_LIMIT_TOKENS = 12_000;
export const DEFAULT_CONTEXT_TOTAL_TOKEN_LIMIT = 60_000;
export const DEFAULT_RESERVED_FOR_OUTPUT_TOKENS = 8_000;
export const DEFAULT_CODEBASE_CONTEXT_MAX_TOKENS = 4_000;
export const DEFAULT_USER_INPUT_MAX_TOKENS = 8_000;
export const DEFAULT_GLOBAL_DECISION_CONTEXT_MAX_TOKENS = 16_000;

/** `allocateContextBudget` 在 availableForInput 上的分配比例（与 InputContextPolicy 一致）。 */
export const CONTEXT_BUDGET_DECISION_RECORD_RATIO = 0.35;
export const CONTEXT_BUDGET_GLOBAL_DECISION_RATIO = 0.25;
export const CONTEXT_BUDGET_CODEBASE_RATIO = 0.1;
export const CONTEXT_BUDGET_USER_INPUT_RATIO = 0.15;
