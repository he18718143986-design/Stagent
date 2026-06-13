import type { BackendMessage } from '../workflow-types/MessageTypes';
import type { ErrorType } from '../workflow-types/RuntimeTypes';

type StageErrorPayload = Omit<Extract<BackendMessage, { type: 'stageError' }>, 'type'>;

export const ERROR_TYPE_INVARIANT_VIOLATION: ErrorType = 'invariant-violation';
export const ERROR_TYPE_RETRY_LIMIT_EXCEEDED: ErrorType = 'retry-limit-exceeded';
export const ERROR_TYPE_LLM_INVALID_OUTPUT: ErrorType = 'llm-invalid-output';
export const ERROR_TYPE_LLM_CONTEXT_OVERFLOW: ErrorType = 'llm-context-overflow';
export const ERROR_TYPE_LLM_REFUSAL: ErrorType = 'llm-refusal';
export const ERROR_TYPE_LLM_QUALITY_BELOW_THRESHOLD: ErrorType = 'llm-quality-below-threshold';
export const ERROR_TYPE_LLM_TIMEOUT: ErrorType = 'llm-timeout';
export const ERROR_TYPE_CODE_RUNNER_TIMEOUT: ErrorType = 'code-runner-timeout';
export const ERROR_TYPE_TOOL_EXECUTION_FAILED: ErrorType = 'tool-execution-failed';
export const ERROR_TYPE_FILE_NOT_FOUND: ErrorType = 'file-not-found';
export const ERROR_TYPE_STAGE_NOT_FOUND: ErrorType = 'stage-not-found';
export const ERROR_TYPE_CONFIDENCE_TOO_LOW: ErrorType = 'confidence-too-low';
export const ERROR_TYPE_UNKNOWN: ErrorType = 'unknown';
export const ERROR_TYPE_SANDBOX_NETWORK_BLOCKED: ErrorType = 'sandbox-network-blocked';
export const ERROR_TYPE_SANDBOX_MEMORY_EXCEEDED: ErrorType = 'sandbox-memory-exceeded';
export const ERROR_TYPE_STATIC_ANALYSIS_FAILED: ErrorType = 'static-analysis-failed';

/** 旧 JSON / normalizeErrorType 可接受的 ErrorType 全集（与 RuntimeTypes 子集对齐）。 */
export const KNOWN_ERROR_TYPES: readonly ErrorType[] = [
  ERROR_TYPE_LLM_TIMEOUT,
  ERROR_TYPE_LLM_CONTEXT_OVERFLOW,
  ERROR_TYPE_LLM_INVALID_OUTPUT,
  ERROR_TYPE_LLM_REFUSAL,
  ERROR_TYPE_LLM_QUALITY_BELOW_THRESHOLD,
  ERROR_TYPE_TOOL_EXECUTION_FAILED,
  ERROR_TYPE_CODE_RUNNER_TIMEOUT,
  ERROR_TYPE_FILE_NOT_FOUND,
  ERROR_TYPE_STAGE_NOT_FOUND,
  ERROR_TYPE_INVARIANT_VIOLATION,
  ERROR_TYPE_RETRY_LIMIT_EXCEEDED,
  ERROR_TYPE_SANDBOX_NETWORK_BLOCKED,
  ERROR_TYPE_SANDBOX_MEMORY_EXCEEDED,
  ERROR_TYPE_STATIC_ANALYSIS_FAILED,
  ERROR_TYPE_CONFIDENCE_TOO_LOW,
  ERROR_TYPE_UNKNOWN,
];

/** 与 InputTruncationPolicy throw 文案一致，供 catch 路径识别。 */
export const LLM_CONTEXT_OVERFLOW_THROW_MESSAGE = ERROR_TYPE_LLM_CONTEXT_OVERFLOW;

export function stageErrorPayload(
  stageId: string,
  errorType: ErrorType,
  error: string,
  extra?: Partial<Pick<StageErrorPayload, 'stdout' | 'stderr' | 'rawOutput'>>,
): StageErrorPayload {
  return { stageId, errorType, error, ...extra };
}

export function invariantStageError(stageId: string, error: string): StageErrorPayload {
  return stageErrorPayload(stageId, ERROR_TYPE_INVARIANT_VIOLATION, error);
}

export function retryLimitStageError(stageId: string, error: string): StageErrorPayload {
  return stageErrorPayload(stageId, ERROR_TYPE_RETRY_LIMIT_EXCEEDED, error);
}

export function llmInvalidOutputStageError(
  stageId: string,
  error: string,
  extra?: Partial<Pick<StageErrorPayload, 'rawOutput'>>,
): StageErrorPayload {
  return stageErrorPayload(stageId, ERROR_TYPE_LLM_INVALID_OUTPUT, error, extra);
}

export function llmContextOverflowStageError(stageId: string, error: string): StageErrorPayload {
  return stageErrorPayload(stageId, ERROR_TYPE_LLM_CONTEXT_OVERFLOW, error);
}
