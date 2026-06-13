import type * as vscode from 'vscode';
import type { SettingsValidationIssue } from './types';
import {
  validatePlanExperienceCombo,
  validateSdkRule20Combo,
  validateTddGateCombo,
} from './gatesValidators';

export function validateGatesSettings(cfg?: vscode.WorkspaceConfiguration): SettingsValidationIssue[] {
  return [
    ...validateTddGateCombo(cfg),
    ...validatePlanExperienceCombo(cfg),
    ...validateSdkRule20Combo(cfg),
  ];
}
