import type * as vscode from 'vscode';
import { resolveRedGreenMode } from '../../RedGreenGate';
import type { SettingsValidationIssue } from './types';

export function validateTddGateCombo(cfg?: vscode.WorkspaceConfiguration): SettingsValidationIssue[] {
  const issues: SettingsValidationIssue[] = [];
  const redGreen = resolveRedGreenMode(cfg?.get('tdd.redGreenGate'));
  const debugRaw = cfg?.get<string | boolean>('debug.requireFeedbackLoop');
  const debugLoop =
    debugRaw === 'off' || debugRaw === 'warn' || debugRaw === 'hard'
      ? debugRaw
      : debugRaw === false
        ? 'off'
        : 'hard';
  const rule20 = cfg?.get<boolean>('enableRuntimeRule20Verify') !== false;
  const toIssuesFail = cfg?.get<boolean>('toIssues.horizontalLayeringFail') === true;

  if (redGreen === 'hard' && debugLoop === 'off') {
    issues.push({
      severity: 'error',
      code: 'tdd-debug-feedback-mismatch',
      message:
        'tdd.redGreenGate=hard 要求 impl 前 RED 测试，但 debug.requireFeedbackLoop=off 关闭了 debug 反馈回路；TDD 与 debug 门禁语义冲突，建议 debug 至少设为 warn。',
      keys: ['tdd.redGreenGate', 'debug.requireFeedbackLoop'],
    });
  }

  if (redGreen === 'hard' && !rule20) {
    issues.push({
      severity: 'warn',
      code: 'red-green-without-rule20',
      message:
        'tdd.redGreenGate=hard 依赖 Rule20 配对的 test/impl 元数据；enableRuntimeRule20Verify=false 时配对关系可能缺失。',
      keys: ['tdd.redGreenGate', 'enableRuntimeRule20Verify'],
    });
  }

  if (toIssuesFail && redGreen === 'off') {
    issues.push({
      severity: 'info',
      code: 'to-issues-fail-without-red-green',
      message:
        'toIssues.horizontalLayeringFail=true 观测 horizontal-tdd，但 tdd.redGreenGate=off；分层 TDD 观测与红绿门未联动。',
      keys: ['toIssues.horizontalLayeringFail', 'tdd.redGreenGate'],
    });
  }

  return issues;
}

export function validatePlanExperienceCombo(cfg?: vscode.WorkspaceConfiguration): SettingsValidationIssue[] {
  const issues: SettingsValidationIssue[] = [];
  const planCompleteness = cfg?.get<boolean>('plan.requireCompleteness') !== false;
  const structuralRepair = cfg?.get<string>('plan.structuralRepair') === 'auto' ? 'auto' : 'off';
  const experienceInject = cfg?.get<boolean>('experience.injectOnGenerate') === true;
  const experienceStore = cfg?.get<boolean>('memory.enableExperienceStore') !== false;

  if (structuralRepair === 'auto' && !planCompleteness) {
    issues.push({
      severity: 'warn',
      code: 'structural-repair-without-completeness',
      message:
        'plan.structuralRepair=auto 仅在计划完整性门禁命中后插入阶段；plan.requireCompleteness=false 时 auto 永不生效。',
      keys: ['plan.structuralRepair', 'plan.requireCompleteness'],
    });
  }

  if (experienceInject && !experienceStore) {
    issues.push({
      severity: 'warn',
      code: 'inject-without-store',
      message:
        'experience.injectOnGenerate=true 但 memory.enableExperienceStore=false；无经验写入则 few-shot 注入通常无效。',
      keys: ['experience.injectOnGenerate', 'memory.enableExperienceStore'],
    });
  }

  return issues;
}

export function validateSdkRule20Combo(cfg?: vscode.WorkspaceConfiguration): SettingsValidationIssue[] {
  const sdkRaw = cfg?.get<string>('execution.sdkPathContractLint');
  const sdkLint = sdkRaw === 'off' || sdkRaw === 'hard' ? sdkRaw : 'warn';
  const rule20 = cfg?.get<boolean>('enableRuntimeRule20Verify') !== false;
  if (sdkLint === 'hard' && !rule20) {
    return [
      {
        severity: 'warn',
        code: 'sdk-lint-hard-without-rule20',
        message:
          'execution.sdkPathContractLint=hard 在 test_run 前阻断；enableRuntimeRule20Verify=false 时 Decision/impl 契约可能未在生成期校验。',
        keys: ['execution.sdkPathContractLint', 'enableRuntimeRule20Verify'],
      },
    ];
  }
  return [];
}
