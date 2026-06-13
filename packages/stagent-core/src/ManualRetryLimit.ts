/** 与 `package.json` → `stagent.maxManualStageRetries` 默认值一致 */
export const DEFAULT_MAX_MANUAL_STAGE_RETRIES = 3;

/** `package.json` 声明 minimum: 1 */
export const MIN_MAX_MANUAL_STAGE_RETRIES = 1;

export type ManualRetryLimitEvaluation =
  | { allowed: true }
  | { allowed: false; message: string };

/**
 * 判断是否允许再发起一次手动重试。
 * `retryCount` 为当前值（不含本次点击）；每次成功进入 retry 路径会 +1。
 * 首轮自动执行不计入（retryCount 从 0 开始）。
 */
export function evaluateManualRetryLimit(
  retryCount: number,
  maxManualStageRetries: number,
): ManualRetryLimitEvaluation {
  const max = normalizeMaxManualStageRetries(maxManualStageRetries);
  if (retryCount >= max) {
    return {
      allowed: false,
      message: `该阶段手动重试已达上限（${max} 次，不含首轮自动执行）。请修改工作流、调整输入或从其他阶段继续。`,
    };
  }
  return { allowed: true };
}

/** 读取 vscode 配置后的规范化（非法/缺失 → 默认 3，且不低于 1） */
export function normalizeMaxManualStageRetries(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return DEFAULT_MAX_MANUAL_STAGE_RETRIES;
  }
  const n = Math.floor(raw);
  if (n < MIN_MAX_MANUAL_STAGE_RETRIES) {
    return MIN_MAX_MANUAL_STAGE_RETRIES;
  }
  return n;
}
