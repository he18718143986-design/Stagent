import type { ErrorType } from '../../workflow-types/RuntimeTypes';
import { ERROR_TYPE_INVARIANT_VIOLATION } from '../stageErrorBuilders';
import type { StageErrorEntry } from './types';

export const GATES_STAGE_ERRORS: Partial<Record<ErrorType, StageErrorEntry>> = {
  [ERROR_TYPE_INVARIANT_VIOLATION]: {
    errorType: ERROR_TYPE_INVARIANT_VIOLATION,
    titleKey: 'stagent.error.catalog.invariantViolation.title',
    hintKey: 'stagent.error.catalog.invariantViolation.hint',
    playbookKeys: [
      'stagent.error.catalog.invariantViolation.playbook.1',
      'stagent.error.catalog.invariantViolation.playbook.2',
      'stagent.error.catalog.invariantViolation.playbook.3',
    ],
  },
};
