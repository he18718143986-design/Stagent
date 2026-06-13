import type * as vscode from 'vscode';
import { getSettingsProfile, type SettingsProfileId } from '../../StagentSettingsProfiles';
import type { SettingsValidationIssue } from './types';

export function validateProfileSettings(cfg?: vscode.WorkspaceConfiguration): SettingsValidationIssue[] {
  const issues: SettingsValidationIssue[] = [];
  const profileRaw = cfg?.get<string>('settingsProfile');
  const profileId: SettingsProfileId =
    profileRaw === 'strict' || profileRaw === 'relaxed' || profileRaw === 'minimal' || profileRaw === 'default'
      ? profileRaw
      : 'default';

  if (profileId !== 'default') {
    const profile = getSettingsProfile(profileId);
    const mismatches: string[] = [];
    for (const [key, expected] of Object.entries(profile.overrides)) {
      const actual = cfg?.get(key);
      if (actual !== undefined && actual !== expected) {
        mismatches.push(`${key}=${JSON.stringify(actual)}（Profile ${profileId} 建议 ${JSON.stringify(expected)}）`);
      }
    }
    if (mismatches.length > 0) {
      issues.push({
        severity: 'info',
        code: 'profile-override-drift',
        message: `settingsProfile=${profileId} 与以下显式配置不一致：${mismatches.join('；')}。显式键值优先于 Profile 文档建议。`,
        keys: ['settingsProfile', ...mismatches.map((m) => m.split('=')[0])],
      });
    }
  }

  if (profileId === 'relaxed') {
    const relaxed = getSettingsProfile('relaxed');
    const hardDrift: string[] = [];
    for (const [key, expected] of Object.entries(relaxed.overrides)) {
      if (expected !== 'hard' && expected !== true) {
        continue;
      }
      const actual = cfg?.get(key);
      if (actual === 'hard' || actual === true) {
        hardDrift.push(key);
      }
    }
    if (hardDrift.length > 0) {
      issues.push({
        severity: 'info',
        code: 'relaxed-profile-hard-drift',
        message: `settingsProfile=relaxed 但以下键为 hard/开启：${hardDrift.join('、')}。`,
        keys: ['settingsProfile', ...hardDrift],
      });
    }
  }

  return issues;
}
