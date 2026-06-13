/**
 * M38.3：test_run / code-runner 失败 stderr 分类 → 可读修复 playbook。
 * Re-export shim：实现已拆分至 test-run-playbook/*。
 */
import { isTestRunStageId } from './workflow/StageIdPatterns';
import { isCodeRunnerTool } from './workflow/StageToolKinds';
import type { Stage } from './WorkflowDefinition';
import { isJsTestRunCommand } from './PlanCompletenessGate';
import { classifyTestRunFailure } from './test-run-playbook/classify';
import {
  ERROR_TYPE_CODE_RUNNER_TIMEOUT,
  ERROR_TYPE_TOOL_EXECUTION_FAILED,
} from './errors/stageErrorBuilders';

export type {
  TestRunFailurePlaybook,
  ClassifyTestRunFailureInput,
} from './test-run-playbook/types';

export { classifyTestRunFailure } from './test-run-playbook/classify';

export function isTestRunFailurePlaybookCandidate(stage: Stage): boolean {
  if (isTestRunStageId(stage.id)) {
    return true;
  }
  if (!isCodeRunnerTool(stage.tool)) {
    return false;
  }
  const cmd = String((stage.toolConfig as { command?: string })?.command ?? '').trim();
  return !!cmd && isJsTestRunCommand(cmd);
}

export function formatTestRunFailurePlaybookMessage(
  playbook: import('./test-run-playbook/types').TestRunFailurePlaybook,
): string {
  const steps = playbook.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return `test-run-playbook（M38.3 · ${playbook.code}）：${playbook.title} — ${playbook.summary}\n\n修复建议：\n${steps}\n\n（原始 stderr 仍附在下方；本地可 skills diagnose 复现同命令。）`;
}

export function resolveTestRunStageErrorMessage(params: {
  stage: Stage;
  errorType: string;
  defaultError: string;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  enabled?: boolean;
}): string {
  if (params.enabled === false) {
    return params.defaultError;
  }
  if (
    params.errorType !== ERROR_TYPE_TOOL_EXECUTION_FAILED &&
    params.errorType !== ERROR_TYPE_CODE_RUNNER_TIMEOUT
  ) {
    return params.defaultError;
  }
  if (!isTestRunFailurePlaybookCandidate(params.stage)) {
    return params.defaultError;
  }
  const cmd = String((params.stage.toolConfig as { command?: string })?.command ?? '').trim();
  const playbook = classifyTestRunFailure({
    stageId: params.stage.id,
    command: cmd,
    exitCode: params.errorType === ERROR_TYPE_CODE_RUNNER_TIMEOUT ? -1 : 1,
    stdout: params.stdout ?? '',
    stderr: params.stderr ?? '',
    timedOut: params.timedOut ?? params.errorType === ERROR_TYPE_CODE_RUNNER_TIMEOUT,
  });
  if (!playbook) {
    return params.defaultError;
  }
  return formatTestRunFailurePlaybookMessage(playbook);
}
