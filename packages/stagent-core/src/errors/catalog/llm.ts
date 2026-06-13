import type { ErrorType } from '../../workflow-types/RuntimeTypes';
import { ERROR_TYPE_LLM_INVALID_OUTPUT, ERROR_TYPE_LLM_TIMEOUT } from '../stageErrorBuilders';
import type { StageErrorEntry } from './types';

export const LLM_STAGE_ERRORS: Partial<Record<ErrorType, StageErrorEntry>> = {
  [ERROR_TYPE_LLM_TIMEOUT]: {
    errorType: ERROR_TYPE_LLM_TIMEOUT,
    titleKey: 'stagent.error.catalog.llmTimeout.title',
    hintKey: 'stagent.error.catalog.llmTimeout.hint',
    playbookKeys: [
      'stagent.error.catalog.llmTimeout.playbook.1',
      'stagent.error.catalog.llmTimeout.playbook.2',
      'stagent.error.catalog.llmTimeout.playbook.3',
    ],
  },
  [ERROR_TYPE_LLM_INVALID_OUTPUT]: {
    errorType: ERROR_TYPE_LLM_INVALID_OUTPUT,
    titleKey: 'stagent.error.catalog.llmInvalidOutput.title',
    hintKey: 'stagent.error.catalog.llmInvalidOutput.hint',
    playbookKeys: [
      'stagent.error.catalog.llmInvalidOutput.playbook.1',
      'stagent.error.catalog.llmInvalidOutput.playbook.2',
      'stagent.error.catalog.llmInvalidOutput.playbook.3',
    ],
  },
};
