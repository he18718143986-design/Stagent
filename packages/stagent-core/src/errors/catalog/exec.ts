import type { ErrorType } from '../../workflow-types/RuntimeTypes';
import {
  ERROR_TYPE_CODE_RUNNER_TIMEOUT,
  ERROR_TYPE_FILE_NOT_FOUND,
  ERROR_TYPE_RETRY_LIMIT_EXCEEDED,
  ERROR_TYPE_SANDBOX_MEMORY_EXCEEDED,
  ERROR_TYPE_SANDBOX_NETWORK_BLOCKED,
  ERROR_TYPE_TOOL_EXECUTION_FAILED,
} from '../stageErrorBuilders';
import type { StageErrorEntry } from './types';

export const EXEC_STAGE_ERRORS: Partial<Record<ErrorType, StageErrorEntry>> = {
  [ERROR_TYPE_TOOL_EXECUTION_FAILED]: {
    errorType: ERROR_TYPE_TOOL_EXECUTION_FAILED,
    titleKey: 'stagent.error.catalog.toolExecutionFailed.title',
    hintKey: 'stagent.error.catalog.toolExecutionFailed.hint',
    playbookKeys: [
      'stagent.error.catalog.toolExecutionFailed.playbook.1',
      'stagent.error.catalog.toolExecutionFailed.playbook.2',
      'stagent.error.catalog.toolExecutionFailed.playbook.3',
    ],
  },
  [ERROR_TYPE_CODE_RUNNER_TIMEOUT]: {
    errorType: ERROR_TYPE_CODE_RUNNER_TIMEOUT,
    titleKey: 'stagent.error.catalog.codeRunnerTimeout.title',
    hintKey: 'stagent.error.catalog.codeRunnerTimeout.hint',
    playbookKeys: [
      'stagent.error.catalog.codeRunnerTimeout.playbook.1',
      'stagent.error.catalog.codeRunnerTimeout.playbook.2',
      'stagent.error.catalog.codeRunnerTimeout.playbook.3',
    ],
  },
  [ERROR_TYPE_FILE_NOT_FOUND]: {
    errorType: ERROR_TYPE_FILE_NOT_FOUND,
    titleKey: 'stagent.error.catalog.fileNotFound.title',
    hintKey: 'stagent.error.catalog.fileNotFound.hint',
    playbookKeys: [
      'stagent.error.catalog.fileNotFound.playbook.1',
      'stagent.error.catalog.fileNotFound.playbook.2',
    ],
  },
  [ERROR_TYPE_RETRY_LIMIT_EXCEEDED]: {
    errorType: ERROR_TYPE_RETRY_LIMIT_EXCEEDED,
    titleKey: 'stagent.error.catalog.retryLimitExceeded.title',
    hintKey: 'stagent.error.catalog.retryLimitExceeded.hint',
    playbookKeys: [
      'stagent.error.catalog.retryLimitExceeded.playbook.1',
      'stagent.error.catalog.retryLimitExceeded.playbook.2',
    ],
  },
  [ERROR_TYPE_SANDBOX_NETWORK_BLOCKED]: {
    errorType: ERROR_TYPE_SANDBOX_NETWORK_BLOCKED,
    titleKey: 'stagent.error.catalog.sandboxNetworkBlocked.title',
    hintKey: 'stagent.error.catalog.sandboxNetworkBlocked.hint',
    playbookKeys: [
      'stagent.error.catalog.sandboxNetworkBlocked.playbook.1',
      'stagent.error.catalog.sandboxNetworkBlocked.playbook.2',
    ],
  },
  [ERROR_TYPE_SANDBOX_MEMORY_EXCEEDED]: {
    errorType: ERROR_TYPE_SANDBOX_MEMORY_EXCEEDED,
    titleKey: 'stagent.error.catalog.sandboxMemoryExceeded.title',
    hintKey: 'stagent.error.catalog.sandboxMemoryExceeded.hint',
    playbookKeys: [
      'stagent.error.catalog.sandboxMemoryExceeded.playbook.1',
      'stagent.error.catalog.sandboxMemoryExceeded.playbook.2',
    ],
  },
};
