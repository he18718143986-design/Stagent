import type * as vscode from 'vscode';
import type { SettingsValidationIssue } from './types';

export function validateLlmSettings(cfg?: vscode.WorkspaceConfiguration): SettingsValidationIssue[] {
  const issues: SettingsValidationIssue[] = [];
  const c = cfg;
  const llmBaseUrl = String(c?.get<string>('llmBaseUrl') ?? '').toLowerCase();
  const maxTokens = c?.get<number>('llmMaxOutputTokens') ?? 16384;
  if (llmBaseUrl.includes('deepseek') && maxTokens > 8192) {
    issues.push({
      severity: 'warn',
      code: 'deepseek-max-tokens-high',
      message:
        'llmBaseUrl 指向 DeepSeek 且 llmMaxOutputTokens>8192；deepseek-chat 服务端上限常为 8192，超出可能被截断或报错。',
      keys: ['llmBaseUrl', 'llmMaxOutputTokens'],
    });
  }
  return issues;
}
