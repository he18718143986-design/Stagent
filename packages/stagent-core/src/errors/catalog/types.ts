import type { ErrorType } from '../../workflow-types/RuntimeTypes';

export interface StageErrorEntry {
  errorType: ErrorType;
  titleKey: string;
  hintKey?: string;
  playbookKeys?: string[];
}
