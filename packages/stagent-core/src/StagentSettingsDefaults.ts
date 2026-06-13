/** 与 `package.json` → `stagent.confidence.pauseThreshold` 默认值一致 */
export const DEFAULT_CONFIDENCE_PAUSE_THRESHOLD = 0.4;

/** 与 `package.json` → `stagent.memory.maxExperienceEntries` 默认值一致 */
export const DEFAULT_MEMORY_MAX_EXPERIENCE_ENTRIES = 500;

/** 与 `package.json` → `stagent.codebaseContext.maxTokens` 默认值一致 */
export const DEFAULT_CODEBASE_CONTEXT_MAX_TOKENS = 4000;

/** 与 `package.json` → `stagent.dagMaxParallelism` 默认值一致（M16.5） */
export const DEFAULT_DAG_MAX_PARALLELISM = 2;

/** 与 `package.json` → `stagent.hitl.contractNodePauseThreshold` 默认值一致（M21.4）。
 *  契约节点（被 ≥2 下游引用 / 数据管道核心 impl）置信度低于该值即升级暂停。 */
export const DEFAULT_CONTRACT_NODE_PAUSE_THRESHOLD = 0.75;

export function resolveContractNodePauseThreshold(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1) {
    return raw;
  }
  return DEFAULT_CONTRACT_NODE_PAUSE_THRESHOLD;
}

export function resolveConfidencePauseThreshold(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1) {
    return raw;
  }
  return DEFAULT_CONFIDENCE_PAUSE_THRESHOLD;
}

export function resolveMemoryMaxExperienceEntries(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) {
    return Math.floor(raw);
  }
  return DEFAULT_MEMORY_MAX_EXPERIENCE_ENTRIES;
}

export function resolveCodebaseContextMaxTokens(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) {
    return Math.floor(raw);
  }
  return DEFAULT_CODEBASE_CONTEXT_MAX_TOKENS;
}

export function resolveDagMaxParallelism(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) {
    return Math.floor(raw);
  }
  return DEFAULT_DAG_MAX_PARALLELISM;
}
