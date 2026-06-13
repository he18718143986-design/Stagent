/** per-task / session debug log 的 workflow 级 event 名（单点定义）。 */

export const DEBUG_EVENT_RUN_START = 'run_start';
export const DEBUG_EVENT_RUN_RESUME = 'run_resume';
export const DEBUG_EVENT_RUN_END = 'run_end';
export const DEBUG_EVENT_RUN_END_CONTRACT_LINT = 'run_end_contract_lint';
export const DEBUG_EVENT_RUN_END_CONTRACT_LINT_ERROR = 'run_end_contract_lint_error';

export const DEBUG_EVENT_DAG_PARALLEL_WAVE = 'dag_parallel_wave';
export const DEBUG_EVENT_DAG_PARALLEL_WAVE_COMPLETE = 'dag_parallel_wave_complete';
/** DAG 调度循环退出（paused/running/complete/stuck）。 */
export const DEBUG_EVENT_DAG_SCHEDULER_EXIT = 'dag_scheduler_exit';
/** 线性执行跳过已完成阶段。 */
export const DEBUG_EVENT_LINEAR_STAGE_SKIP = 'linear_stage_skip';
/** resumeInstance 失败（实例未找到或激活失败）。 */
export const DEBUG_EVENT_RESUME_FAILED = 'resume_failed';
/** 活跃实例切换被守卫拒绝。 */
export const DEBUG_EVENT_INSTANCE_SWITCH_BLOCKED = 'instance_switch_blocked';

export const DEBUG_EVENT_PARSE_FAILED_RETRY = 'parse_failed_retry';
export const DEBUG_EVENT_GENERATION_SUPERSEDED = 'generation_superseded';
export const DEBUG_EVENT_TASK_TYPE_RESOLVED = 'task_type_resolved';
export const DEBUG_EVENT_PATH_ROUTER_RESOLVED = 'path_router_resolved';
export const DEBUG_EVENT_CLARIFY_REUSE_STRATEGY = 'clarify_reuse_strategy';

export const DEBUG_EVENT_CODEBASE_SNAPSHOT = 'codebase_snapshot';
export const DEBUG_EVENT_ADR_CONTEXT = 'adr_context';
export const DEBUG_EVENT_EXPERIENCE_FEW_SHOT = 'experience_few_shot';
export const DEBUG_EVENT_EXPERIENCE_READ_WARN = 'experience_read_warn';

export const DEBUG_EVENT_PROMPT_VERSIONS_LOADED = 'prompt_versions_loaded';
export const DEBUG_EVENT_TASK_DIR_REBOUND = 'task_dir_rebound';
export const DEBUG_EVENT_PRE_EXEC_SHELL_CREATED = 'pre_exec_shell_created';

export const DEBUG_EVENT_RULE20_RUNTIME_VERIFY = 'rule20_runtime_verify';
export const DEBUG_EVENT_PLAN_STRUCTURAL_REPAIR = 'plan_structural_repair';
export const DEBUG_EVENT_PLAN_COMPLETENESS_BLOCKED = 'plan_completeness_blocked';
export const DEBUG_EVENT_SKELETON_COMPILER_EXPAND = 'skeleton_compiler_expand';

/** 阶段级 event 名（单点定义；字符串值与历史日志格式兼容）。 */

export const DEBUG_EVENT_STAGE_START = 'stage_start';
export const DEBUG_EVENT_STAGE_END = 'stage_end';
export const DEBUG_EVENT_STAGE_ERROR = 'stage_error';
export const DEBUG_EVENT_TOOL_CONFIG_SNAPSHOT = 'tool_config_snapshot';

export const DEBUG_EVENT_CONFIDENCE_SCORED = 'confidence_scored';
export const DEBUG_EVENT_POST_STAGE_QUALITY_GATE_ERROR = 'post_stage_quality_gate_error';
export const DEBUG_EVENT_POST_IMPL_STATIC_ANALYSIS = 'post_impl_static_analysis';
export const DEBUG_EVENT_POST_IMPL_STATIC_ANALYSIS_ERROR = 'post_impl_static_analysis_error';
export const DEBUG_EVENT_LLM_OUTPUT_PREVIEW = 'llm_output_preview';

export const DEBUG_EVENT_DEGRADE_MODE_SWITCH = 'degrade_mode_switch';
/** 引擎 best-effort 降级（上下文/持久化/生成 supersede 等）；可重建轨迹用。 */
export const DEBUG_EVENT_DEGRADED = 'degraded';
export const DEBUG_EVENT_INPUT_SUMMARY_SKIPPED = 'input_summary_skipped';
export const DEBUG_EVENT_INPUT_SUMMARY_FALLBACK = 'input_summary_fallback';
export const DEBUG_EVENT_GLOBAL_DECISION_CONTEXT_INJECT = 'global_decision_context_inject';
export const DEBUG_EVENT_CHARTER_CONSTRAINTS_INJECT = 'charter_constraints_inject';
export const DEBUG_EVENT_CHARTER_GRILL_AUTO_ANSWER = 'charter_grill_auto_answer';

export const DEBUG_EVENT_HITL_EVALUATED = 'hitl_evaluated';
export const DEBUG_EVENT_RETRY_TRIGGER = 'retry_trigger';
export const DEBUG_EVENT_ADR_PERSISTED = 'adr_persisted';
export const DEBUG_EVENT_ADR_SKIPPED = 'adr_skipped';
export const DEBUG_EVENT_ARTIFACT_ROLLBACK = 'artifact_rollback';

export const DEBUG_EVENT_RED_GREEN_GATE = 'red_green_gate';
export const DEBUG_EVENT_SDK_PATH_CONTRACT_LINT = 'sdk_path_contract_lint';
export const DEBUG_EVENT_SDK_PATH_CONTRACT_LINT_ERROR = 'sdk_path_contract_lint_error';
export const DEBUG_EVENT_PRE_TEST_RUN_CONTRACT_LINT = 'pre_test_run_contract_lint';
export const DEBUG_EVENT_PRE_TEST_RUN_CONTRACT_LINT_ERROR = 'pre_test_run_contract_lint_error';

export const DEBUG_EVENT_PATCH_FILE_MISSING = 'patch_file_missing';
export const DEBUG_EVENT_PATCH_FALLBACK = 'patch_fallback';
export const DEBUG_EVENT_TEST_RUN_FAILURE_PLAYBOOK = 'test_run_failure_playbook';
export const DEBUG_EVENT_WRITE_OUTPUT_TO_FILE_REUSE_ALL = 'writeOutputToFile_reuse_all';
export const DEBUG_EVENT_WRITE_OUTPUT_TO_FILE_WRITE = 'writeOutputToFile_write';
export const DEBUG_EVENT_WRITE_OUTPUT_INTEGRITY_MISMATCH = 'write_output_integrity_mismatch';
export const DEBUG_EVENT_TEST_WRITE_GATE_RETRY = 'test_write_gate_retry';
export const DEBUG_EVENT_MUTATE_GATE_RETRY = 'mutate_gate_retry';

export const DEBUG_EVENT_USER_ACTION = 'user_action';

import { isBuiltinQualityGateId } from './QualityGateIds';

/** 内置 quality gate 的 debug event（值与 gate id 相同；第三方 gate 原样 passthrough）。 */
export function debugEventForQualityGate(gateId: string): string {
  return isBuiltinQualityGateId(gateId) ? gateId : gateId;
}
