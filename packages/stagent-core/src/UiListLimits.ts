/** UI 列表 / 诊断展示条数上限（与 LogPreviewLimits 字符截断分离）。 */
export const CONFIRM_AITIP_MAX_CHARS = 120;
export const PREGEN_EXPERIENCE_REFS_MAX = 20;
export const PREGEN_CLARIFY_QUESTIONS_MAX = 5;
export const DEP_GRAPH_TOP_NODES_MAX = 5;
export const DEP_GRAPH_IMPORTS_PREVIEW_MAX = 4;
export const DEP_GRAPH_CYCLE_NODES_MAX = 3;
export const DAG_UNREACHABLE_STAGES_DISPLAY_MAX = 12;
export const CODEBASE_EXPORTS_PREVIEW_MAX = 6;
export const PATCH_SEARCH_PREVIEW_CHARS = 50;
export const WORKFLOW_DAG_CYCLE_NODES_DISPLAY_MAX = 8;
export const FAILURE_PATTERN_REPORT_MAX = 20;
export const EXPERIENCE_GEN_CONTEXT_MAX = 8;
/** 成功 experience few-shot 选取上限（生成器 user payload）。 */
export const EXPERIENCE_GEN_PICKED_MAX = 3;
/** test_run 失败经验 few-shot 选取上限。 */
export const EXPERIENCE_FAILURE_FEW_SHOT_MAX = 2;
/** EXPERIENCE_GEN_CONTEXT_MAX=8 为单条经验 stageOutcomes 预览条数；与 PICKED/FAILURE 上限语义不同。 */
export const PROMPT_SLOT_HISTORY_MAX = 50;
export const HITL_CONFIDENCE_REASONS_MAX = 2;
export const COMPLEXITY_DECOMPOSITION_PREVIEW_MAX = 6;
export const PROFILE_DIFF_LINES_MAX = 6;
export const PROFILE_DIFF_ITEMS_MAX = 5;
export const PROFILE_DIFF_HINTS_MAX = 4;
export const CODE_RUNNER_PYTHON_MODULES_PREVIEW_MAX = 12;
export const WEBVIEW_PROFILE_GATE_DIFF_PREVIEW_MAX = 2;
export const FAILURE_PATTERN_TOP_STAGES_MAX = 10;
export const GENERATED_WORKFLOW_VIOLATION_PREVIEW_MAX = 3;
export const GRILL_CODE_EXPLORE_KEYWORDS_PREVIEW_MAX = 4;
