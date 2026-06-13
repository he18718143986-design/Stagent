/**
 * Stage budget semantics: generation-side soft cap vs runtime warn threshold.
 * Prompt 文案中的「约 50 阶段」对应 GENERATION_STAGE_SOFT_CAP；运行时 plan summary / Rule20 预警用 RUNTIME_STAGE_WARN_THRESHOLD。
 */
import { MAX_STAGES_WARN } from './WorkflowLimits';

/** 生成 / 复杂度估算 soft cap（与 prompt SPEC 一致）。 */
export const GENERATION_STAGE_SOFT_CAP = 50;

/** 运行时计划阶段数预警阈值（确认页 / Rule20 stage_count_near_limit）。 */
export const RUNTIME_STAGE_WARN_THRESHOLD = MAX_STAGES_WARN;
