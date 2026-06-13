import type { ErrorType } from '../../workflow-types/RuntimeTypes';
import { ERROR_TYPE_CONFIDENCE_TOO_LOW } from '../stageErrorBuilders';
import type { StageErrorEntry } from './types';

export const HITL_STAGE_ERRORS: Partial<Record<ErrorType, StageErrorEntry>> = {
  [ERROR_TYPE_CONFIDENCE_TOO_LOW]: {
    errorType: ERROR_TYPE_CONFIDENCE_TOO_LOW,
    titleKey: 'stagent.error.catalog.confidenceTooLow.title',
    hintKey: 'stagent.error.catalog.confidenceTooLow.hint',
    playbookKeys: [
      'stagent.error.catalog.confidenceTooLow.playbook.1',
      'stagent.error.catalog.confidenceTooLow.playbook.2',
    ],
  },
};
