import type { ErrorType } from '../workflow-types/RuntimeTypes';
import {
  ERROR_TYPE_CODE_RUNNER_TIMEOUT,
  ERROR_TYPE_CONFIDENCE_TOO_LOW,
  ERROR_TYPE_FILE_NOT_FOUND,
  ERROR_TYPE_INVARIANT_VIOLATION,
  ERROR_TYPE_LLM_INVALID_OUTPUT,
  ERROR_TYPE_LLM_TIMEOUT,
  ERROR_TYPE_RETRY_LIMIT_EXCEEDED,
  ERROR_TYPE_TOOL_EXECUTION_FAILED,
} from '../errors/stageErrorBuilders';

/** kebab-case ErrorType → camelCase segment for `stagent.error.catalog.{segment}.*` */
export const ERROR_TYPE_CATALOG_SLUG: Partial<Record<ErrorType, string>> = {
  [ERROR_TYPE_TOOL_EXECUTION_FAILED]: 'toolExecutionFailed',
  [ERROR_TYPE_CODE_RUNNER_TIMEOUT]: 'codeRunnerTimeout',
  [ERROR_TYPE_FILE_NOT_FOUND]: 'fileNotFound',
  [ERROR_TYPE_RETRY_LIMIT_EXCEEDED]: 'retryLimitExceeded',
  [ERROR_TYPE_LLM_TIMEOUT]: 'llmTimeout',
  [ERROR_TYPE_LLM_INVALID_OUTPUT]: 'llmInvalidOutput',
  [ERROR_TYPE_INVARIANT_VIOLATION]: 'invariantViolation',
  [ERROR_TYPE_CONFIDENCE_TOO_LOW]: 'confidenceTooLow',
};

export function catalogKeySegment(errorType: ErrorType): string {
  return ERROR_TYPE_CATALOG_SLUG[errorType] ?? errorType.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
