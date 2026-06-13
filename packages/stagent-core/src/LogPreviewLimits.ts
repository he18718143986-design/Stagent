/** 日志 / 会话预览截断长度（与 FsAsync.DEFAULT_FS_READ_TIMEOUT_MS 等同的 60s 超时见 StaticAnalysisPipeline 注释交叉引用）。 */
export const LOG_PREVIEW_SHORT = 200;
export const LOG_PREVIEW_MEDIUM = 500;
export const LOG_PREVIEW_RAW_OUTPUT = 4000;
export const LOG_PREVIEW_USER_SNIPPET = 200;
export const LOG_PREVIEW_DEBUG_ERROR = 400;
export const LOG_PREVIEW_INPUT_SUMMARY_FALLBACK = 1200;
export const LOG_PREVIEW_ERROR_HEAD = 120;
/** lastFailureSnapshot 中 stdout/stderr 尾部截断上限。 */
export const FAILURE_SNAPSHOT_STDIO_MAX = 2000;
export const WORKFLOW_META_TITLE_MAX = 80;
export const ADR_DECISION_RECORD_PREVIEW_CHARS = 600;
export const CODE_EXPLORE_LINE_PREVIEW_CHARS = 240;
export const PRE_EXEC_SHELL_INSTANCE_PREFIX_CHARS = 8;
export const CONTENT_HASH_HEX_PREFIX_CHARS = 16;
