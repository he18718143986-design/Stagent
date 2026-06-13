export type SettingsValidationSeverity = 'error' | 'warn' | 'info';

export interface SettingsValidationIssue {
  severity: SettingsValidationSeverity;
  code: string;
  message: string;
  keys: string[];
}
