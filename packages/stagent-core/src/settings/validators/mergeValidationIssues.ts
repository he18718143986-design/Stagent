import type { SettingsValidationIssue } from './types';

export function mergeValidationIssues(issueLists: SettingsValidationIssue[][]): SettingsValidationIssue[] {
  return issueLists.flat();
}
