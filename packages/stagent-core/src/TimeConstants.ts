/** 跨模块时间常量（避免魔法数字散落）。 */
export const MS_PER_DAY = 86_400_000;
export const MS_PER_MINUTE = 60_000;

export const GIT_DIFF_TIMEOUT_MS = 3000;

export const SANDBOX_DEFAULT_MEMORY_MB = 512;

/** 实例热路径 save 防抖（scheduleSave）。 */
export const INSTANCE_PERSIST_DEBOUNCE_MS = 200;

/** JSONL 原子追加文件锁默认参数。 */
export const JSONL_LOCK_MAX_WAIT_MS = 2000;
export const JSONL_LOCK_STALE_MS = 10_000;
export const JSONL_LOCK_STEP_MS = 25;
