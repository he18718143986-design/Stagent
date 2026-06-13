import { GLOBAL_ARCHITECTURE_IMPL_STAGE_THRESHOLD } from './GlobalArchitectureThresholds';

/** 预估 impl 模块数触发全局架构决策（与 Rule20 / globalArchitecturePolicy 对齐）。 */
export const COMPLEXITY_IMPL_THRESHOLD = GLOBAL_ARCHITECTURE_IMPL_STAGE_THRESHOLD;

/** codebase snapshot 模块数估算上限。 */
export const COMPLEXITY_SNAPSHOT_MODULE_CAP = 20;

/** snapshot 模块数 → impl 估算除数（语义不同于 impl 阈值）。 */
export const COMPLEXITY_SNAPSHOT_MODULES_DIVISOR = 5;

/** 已有模块数超过该值触发全局架构决策。 */
export const COMPLEXITY_EXISTING_MODULES_ARCH_TRIGGER = 25;

export const COMPLEXITY_PER_MODULE_STAGES = 4;
export const COMPLEXITY_BASE_STAGES_WITH_ARCH = 6;
export const COMPLEXITY_BASE_STAGES_WITHOUT_ARCH = 3;

/** 建议垂直切片骨架上限（decomposition 数组长度）。 */
export const COMPLEXITY_SUGGESTED_DECOMPOSITION_MAX = 8;

/** 生成侧 near-cap 预警（低于 GENERATION_STAGE_SOFT_CAP=50；不同于 RUNTIME_STAGE_WARN_THRESHOLD=45）。 */
export const COMPLEXITY_NEAR_STAGE_LIMIT = 40;
