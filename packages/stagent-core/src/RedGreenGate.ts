import type { Stage, WorkflowDefinition } from './WorkflowDefinition';

/**
 * M22：反馈回路优先 + 真·红绿一切片一循环（借鉴 skills `tdd` / `diagnose`）。
 *
 * 纯函数 + 一个运行期门：
 * - `evaluateRedGreen`：impl 执行前，若配对测试已 GREEN（实现还没写就通过）→ 疑似空测试 → warn/block。
 * - `isHorizontalTddPlan`：检测「全部 test 阶段在前、全部 impl 在后」的 horizontal 反模式（warning-only）。
 *
 * 默认 mode='warn'（仅告警）；'hard' 才阻断；'off' 关闭（回滚）。对应 SPEC §9.1 I-25（SOFT §）。
 */

export type RedGreenMode = 'off' | 'warn' | 'hard';

/** 与 package.json `stagent.tdd.redGreenGate` 默认值一致 */
export const DEFAULT_RED_GREEN_MODE: RedGreenMode = 'warn';

export function resolveRedGreenMode(raw: unknown): RedGreenMode {
  return raw === 'off' || raw === 'hard' || raw === 'warn' ? raw : DEFAULT_RED_GREEN_MODE;
}

/** stage_impl_<X> / stage_test_write_<X> / stage_test_run_<X> → <X> */
export function semanticOfStage(id: string): string | undefined {
  const m = /^stage_(?:impl|test_write|test_run)_(.+)$/.exec(id);
  return m?.[1];
}

/** 找 stage_impl_<X> 的配对验证阶段（优先 stage_test_run_<X>，其次 stage_test_write_<X>） */
export function findPairedTestStage(
  workflow: WorkflowDefinition,
  implStageId: string,
): Stage | undefined {
  const sem = semanticOfStage(implStageId);
  if (!sem) {
    return undefined;
  }
  const stages = workflow.stages ?? [];
  return (
    stages.find((s) => s.id === `stage_test_run_${sem}`) ??
    stages.find((s) => s.id === `stage_test_write_${sem}`)
  );
}

/** RED = 非零退出（impl 尚未实现，配对测试应失败） */
export function interpretRedFromExitCode(exitCode: number): boolean {
  return exitCode !== 0;
}

export interface RedGreenEvaluation {
  outcome: 'pass' | 'warn' | 'block';
  reason: string;
}

/**
 * impl 执行前的红绿判定：
 * - 门未激活（off / 无配对测试 / 未实际跑）→ pass
 * - 跑了且 RED（非零）→ pass（符合预期：实现前测试应失败）
 * - 跑了却 GREEN（零退出）→ 疑似空测试：warn（默认）或 block（hard）
 */
export function evaluateRedGreen(input: {
  mode: RedGreenMode;
  pairedTestExists: boolean;
  ranTest: boolean;
  red: boolean;
}): RedGreenEvaluation {
  if (input.mode === 'off' || !input.pairedTestExists || !input.ranTest) {
    return { outcome: 'pass', reason: '红绿门未激活' };
  }
  if (input.red) {
    return { outcome: 'pass', reason: '配对测试在实现前为 RED（符合预期）' };
  }
  const reason = '配对测试在实现写入前已 GREEN —— 疑似空测试 / 未真正验证行为';
  return input.mode === 'hard'
    ? { outcome: 'block', reason }
    : { outcome: 'warn', reason };
}

/**
 * horizontal TDD 反模式：存在 ≥2 个测试阶段与 ≥2 个 impl 阶段，且**所有**测试阶段都排在
 * **所有** impl 阶段之前（先写全部测试再写全部实现），与 tdd 的「一切片一循环」相悖。
 */
export function isHorizontalTddPlan(stages: Stage[]): boolean {
  const testIdx: number[] = [];
  const implIdx: number[] = [];
  stages.forEach((s, i) => {
    if (/^stage_test_(write|run)_/.test(s.id)) {
      testIdx.push(i);
    } else if (/^stage_impl_/.test(s.id)) {
      implIdx.push(i);
    }
  });
  if (testIdx.length < 2 || implIdx.length < 2) {
    return false;
  }
  return Math.max(...testIdx) < Math.min(...implIdx);
}
