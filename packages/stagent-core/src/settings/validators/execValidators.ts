import type * as vscode from 'vscode';
import { isSandboxExecOnPath, resolveSandboxCapability } from '../../sandbox/SandboxCapabilityMatrix';
import { readSandboxEnabled } from '../readers/exec';
import type { SettingsValidationIssue } from './types';

export function validateExecSettings(cfg?: vscode.WorkspaceConfiguration): SettingsValidationIssue[] {
  const issues: SettingsValidationIssue[] = [];
  if (!readSandboxEnabled(cfg)) {
    return issues;
  }

  issues.push({
    severity: 'info',
    code: 'sandbox-network-hint',
    message:
      '沙箱已启用（实验性）：code-runner 可走隔离执行，但 npm/pip 等安装命令仍可能请求网络。',
    keys: ['sandbox.enabled'],
  });

  const capability = resolveSandboxCapability();
  if (capability.sandboxEnforced) {
    return issues;
  }

  if (process.platform === 'darwin' && !isSandboxExecOnPath()) {
    issues.push({
      severity: 'warn',
      code: 'sandbox-exec-missing',
      message:
        'sandbox.enabled 已开启但本机无 sandbox-exec：无法提供内核级隔离。详见 docs/SANDBOX_PLATFORMS.md。',
      keys: ['sandbox.enabled'],
    });
    return issues;
  }

  issues.push({
    severity: 'warn',
    code: 'sandbox-soft-constraint-only',
    message: `sandbox.enabled 在当前平台（${capability.platform}）仅为软约束，非安全边界；不可信代码请使用 macOS 内核沙箱或外部容器。详见 docs/SANDBOX_PLATFORMS.md。`,
    keys: ['sandbox.enabled'],
  });

  return issues;
}
