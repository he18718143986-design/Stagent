/**
 * 阶段控制流信号（非真实异常）。
 *
 * 某些阶段在失败时已自行完成处理（postStageError + 置 runtime/instance.status=failed），
 * 只需向 {@link executeStageStep} 的执行循环回传「已处理、按 failed 收尾」，
 * 不应再被 {@link handleStageExecutionError} 当作未捕获异常二次上报。
 *
 * 历史实现用 `throw new Error('pre-impl-quality-gate-failed')` + `error.message === '...'`
 * 字符串匹配来传递该信号——任何改动字面量都会静默断流。这里改用带类型 `reason`
 * 的专用错误类，使控制流可被类型系统约束、重构安全。
 */
export type StageHandledReason =
  | 'pre-impl-quality-gate-failed'
  | 'post-test-write-quality-gate-failed'
  | 'post-mutate-quality-gate-failed'
  | 'write-output-normalize-failed'
  | 'write-output-integrity-failed'
  | 'patch-mode-invalid-json';

export class StageAlreadyHandledError extends Error {
  constructor(readonly reason: StageHandledReason) {
    // message 保留为 reason，兼容既有日志/断言（如测试用 /patch-mode-invalid-json/ 匹配）。
    super(reason);
    this.name = 'StageAlreadyHandledError';
  }
}

/** 类型守卫：识别「阶段已自行处理失败」的控制流信号。 */
export function isStageAlreadyHandledError(e: unknown): e is StageAlreadyHandledError {
  return e instanceof StageAlreadyHandledError;
}
