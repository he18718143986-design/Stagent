/** 运行时插入的 replan stage id 前缀（与 confirm 期 stagent_ / M40 区分）。 */
export const RUNTIME_REPLAN_STAGE_ID_PREFIX = 'stage_runtime_replan_';

/** fix-exhausted 升级链第 2 级：重写测试（假红嫌疑）的 replan stage 前缀。 */
export const RUNTIME_REPLAN_TESTFIX_STAGE_ID_PREFIX = 'stage_runtime_replan_testfix_';

/** fix-exhausted 升级链第 3 级：testfix 后仍红 → 按重写测试对齐 impl。 */
export const RUNTIME_REPLAN_POSTTESTFIX_FIX_STAGE_ID_PREFIX = 'stage_runtime_replan_posttestfix_fix_';

/** 是否为「测试重写」replan stage（EQ-4 条件允许改 test 的唯一入口）。 */
export function isRuntimeReplanTestFixStageId(stageId: string): boolean {
  return stageId.startsWith(RUNTIME_REPLAN_TESTFIX_STAGE_ID_PREFIX);
}

export function semanticFromRuntimeReplanTestFixStageId(stageId: string): string | undefined {
  return stageId.startsWith(RUNTIME_REPLAN_TESTFIX_STAGE_ID_PREFIX)
    ? stageId.slice(RUNTIME_REPLAN_TESTFIX_STAGE_ID_PREFIX.length)
    : undefined;
}

export const RUNTIME_REPLAN_MARKER = '[系统插入 · runtime-replan]';

/** 单 slice 默认最多插入 replan stage 次数（fix → testfix → posttestfix-impl）。 */
export const DEFAULT_RUNTIME_REPLAN_MAX_PER_SLICE = 3;

/** 单 workflow 实例默认最多 replan 次数（v1）。 */
export const DEFAULT_RUNTIME_REPLAN_MAX_PER_INSTANCE = 6;

export const RUNTIME_REPLAN_OUTPUT_KEY = '_runtimeReplan';

/** test_run ↔ fix_if_failed 自修复链尝试计数（写在 test_run runtime.outputs）。 */
export const FIX_CHAIN_OUTPUT_KEY = '_fixChain';

/** 同 slice fix_if_failed 仍红时触发 fix-exhausted replan 的默认上限（v1）。 */
export const DEFAULT_FIX_EXHAUSTED_MAX_ATTEMPTS = 2;
