import type { SettingsValidationIssue } from './types';

export function formatSettingsValidationReport(issues: SettingsValidationIssue[]): string {
  if (issues.length === 0) {
    return 'Stagent 配置校验：未发现矛盾组合。';
  }
  const lines = ['Stagent 配置校验：'];
  for (const issue of issues) {
    const tag = issue.severity.toUpperCase();
    lines.push(`  [${tag}] ${issue.code}: ${issue.message}`);
  }
  return lines.join('\n');
}
