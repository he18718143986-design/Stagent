/** #5：单引擎活跃实例切换守卫（非多实例队列，仅防执行中误切换与丢盘）。 */

export type InstanceSwitchBlockCode = 'execution-in-flight';

export type InstanceSwitchDecision =
  | { ok: true }
  | { ok: false; code: InstanceSwitchBlockCode; reason: string };

/**
 * 是否允许将 `this.instance` 从 currentKey 切换到 targetKey。
 * - 同 key：始终允许（resume 幂等 / 刷新 UI）。
 * - executeNextStage 执行中（executionDepth>0）且目标不同：拒绝，避免并发写同一引擎状态。
 */
export function canSwitchActiveInstance(params: {
  currentKey: string | undefined;
  targetKey: string;
  executionDepth: number;
}): InstanceSwitchDecision {
  if (params.currentKey === params.targetKey) {
    return { ok: true };
  }
  if (params.executionDepth > 0) {
    return {
      ok: false,
      code: 'execution-in-flight',
      reason: '当前任务正在执行阶段，请等待暂停或完成后再切换其他任务。',
    };
  }
  return { ok: true };
}
