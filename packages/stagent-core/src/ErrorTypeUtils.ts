import type { ErrorType } from './WorkflowDefinition';
import {
  ERROR_TYPE_CODE_RUNNER_TIMEOUT,
  ERROR_TYPE_FILE_NOT_FOUND,
  ERROR_TYPE_INVARIANT_VIOLATION,
  ERROR_TYPE_LLM_CONTEXT_OVERFLOW,
  ERROR_TYPE_LLM_INVALID_OUTPUT,
  ERROR_TYPE_LLM_TIMEOUT,
  ERROR_TYPE_STAGE_NOT_FOUND,
  ERROR_TYPE_TOOL_EXECUTION_FAILED,
  ERROR_TYPE_UNKNOWN,
  KNOWN_ERROR_TYPES,
} from './errors/stageErrorBuilders';

const KNOWN_ERROR_TYPE_SET = new Set<string>(KNOWN_ERROR_TYPES);

/** 旧 JSON / 外部消息缺少新 ErrorType 时回落 `unknown`。 */
export function normalizeErrorType(raw: unknown): ErrorType {
  if (typeof raw === 'string' && KNOWN_ERROR_TYPE_SET.has(raw)) {
    return raw as ErrorType;
  }
  return ERROR_TYPE_UNKNOWN;
}

export class StagentError extends Error {
  readonly errorType: ErrorType;

  constructor(errorType: ErrorType, message: string) {
    super(message);
    this.name = 'StagentError';
    this.errorType = errorType;
    Object.setPrototypeOf(this, StagentError.prototype);
  }
}

export function invariantViolation(detail: string): StagentError {
  return new StagentError(ERROR_TYPE_INVARIANT_VIOLATION, `${ERROR_TYPE_INVARIANT_VIOLATION}:${detail}`);
}

export function fileNotFound(filePath: string): StagentError {
  return new StagentError(ERROR_TYPE_FILE_NOT_FOUND, `${ERROR_TYPE_FILE_NOT_FOUND}:${filePath}`);
}

export function stageNotFound(stageId: string | undefined): StagentError {
  return new StagentError(ERROR_TYPE_STAGE_NOT_FOUND, `${ERROR_TYPE_STAGE_NOT_FOUND}:${stageId ?? ''}`);
}

export function codeRunnerTimeout(): StagentError {
  return new StagentError(ERROR_TYPE_CODE_RUNNER_TIMEOUT, ERROR_TYPE_CODE_RUNNER_TIMEOUT);
}

export function toolExecutionFailed(detail: string): StagentError {
  return new StagentError(ERROR_TYPE_TOOL_EXECUTION_FAILED, `${ERROR_TYPE_TOOL_EXECUTION_FAILED}: ${detail}`);
}

export function implHollowOutput(detail = 'impl-hollow-output'): StagentError {
  return new StagentError(ERROR_TYPE_LLM_INVALID_OUTPUT, detail);
}

export function llmContextOverflow(detail = 'llm-context-overflow'): StagentError {
  return new StagentError(ERROR_TYPE_LLM_CONTEXT_OVERFLOW, detail);
}

export function llmCancelled(detail = 'llm-cancelled'): StagentError {
  return new StagentError(ERROR_TYPE_LLM_TIMEOUT, detail);
}

export function classifyThrownError(e: unknown, cancelled = false): ErrorType {
  if (e instanceof StagentError) {
    return e.errorType;
  }
  if (cancelled) {
    return ERROR_TYPE_LLM_TIMEOUT;
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes(ERROR_TYPE_CODE_RUNNER_TIMEOUT)) {
    return ERROR_TYPE_CODE_RUNNER_TIMEOUT;
  }
  return ERROR_TYPE_TOOL_EXECUTION_FAILED;
}
