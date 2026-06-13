import type { CodeRunnerConfig } from '../WorkflowDefinition';
import {
  collectAllCodeRunnerLintIssues,
  formatCodeRunnerCommandIssue,
  isDangerousCommandIssue,
} from '../CodeRunnerCommandLint';
import { readDangerousCommandLintMode } from '../settings/SettingsReaders';
import { collectConfigContractIssuesOnDisk } from '../ConfigContractLint';
import { invariantViolation, toolExecutionFailed } from '../ErrorTypeUtils';
import { getStagentConfiguration } from '../settings/getStagentConfiguration';
import {
  readVerificationDeterministic,
  readVerificationFlakyRerunCount,
} from '../settings/readers/verification';
import { applyVerificationConfidence, isVerificationStage } from '../quality-gates/verificationConfidence';
import { summarizeVerificationRuns, type VerificationRunRecord } from '../quality-gates/verificationFlaky';
import { CODE_RUNNER_EXIT_OUTPUT_KEY, VERIFICATION_RUNS_OUTPUT_KEY } from '../WorkflowOutputKeys';
import type { NonLlmToolExecutionParams } from '../WorkflowExecutorTypes';

export async function runCodeRunnerTool(params: NonLlmToolExecutionParams): Promise<boolean> {
  const { stage, runtime, outKey, instance, instanceKey, resolveOutputPath, runCodeRunner, stageIndex } = params;
  const cfg = stage.toolConfig as CodeRunnerConfig;
  if (!cfg.command?.trim()) {
    throw invariantViolation(`code-runner missing command at ${stage.id}`);
  }
  const issues = collectAllCodeRunnerLintIssues(String(cfg.command), instance.definition, stageIndex);
  const dangerousMode = readDangerousCommandLintMode();
  const blocking = issues.filter(
    (i) => !isDangerousCommandIssue(i) || dangerousMode === 'hard',
  );
  if (dangerousMode === 'warn') {
    for (const i of issues.filter(isDangerousCommandIssue)) {
      params.warn?.(formatCodeRunnerCommandIssue(stage.id, i));
    }
  }
  if (blocking.length > 0) {
    throw invariantViolation(formatCodeRunnerCommandIssue(stage.id, blocking[0]));
  }
  const contractWorkspaceDir = resolveOutputPath(instanceKey, cfg.workingDir?.trim() || '.', cfg.pathBase ?? 'workspace');
  const contractIssues = collectConfigContractIssuesOnDisk(String(cfg.command), contractWorkspaceDir);
  if (contractIssues.length > 0) {
    throw invariantViolation(contractIssues[0].message);
  }
  const cfgSettings = getStagentConfiguration();
  const verification = isVerificationStage(stage);
  const rerunCount = verification ? readVerificationFlakyRerunCount(cfgSettings) : 1;
  const deterministic = verification && readVerificationDeterministic(cfgSettings);
  const runs: VerificationRunRecord[] = [];
  let lastResult = { exitCode: 1, stdout: '', stderr: '' };

  for (let attempt = 1; attempt <= rerunCount; attempt++) {
    lastResult = await runCodeRunner(cfg, instanceKey, stage.id, { deterministic });
    runs.push({ attempt, exitCode: lastResult.exitCode });
    if (lastResult.exitCode !== 0) {
      break;
    }
  }

  if (verification) {
    runtime.outputs[VERIFICATION_RUNS_OUTPUT_KEY] = runs;
    const summary = summarizeVerificationRuns(runs);
    if (summary.flaky) {
      runtime.outputs[CODE_RUNNER_EXIT_OUTPUT_KEY] = lastResult.exitCode;
      runtime.outputs.stdout = lastResult.stdout;
      runtime.outputs.stderr = lastResult.stderr;
      throw toolExecutionFailed(
        `verification-flaky: ${summary.passCount}/${summary.totalRuns} passed`,
      );
    }
  }

  runtime.outputs[CODE_RUNNER_EXIT_OUTPUT_KEY] = lastResult.exitCode;
  runtime.outputs.stdout = lastResult.stdout;
  runtime.outputs.stderr = lastResult.stderr;
  runtime.outputs[outKey] = cfg.captureOutput
    ? [lastResult.stdout, lastResult.stderr].filter(Boolean).join('\n')
    : `exitCode=${lastResult.exitCode}`;
  if (lastResult.exitCode !== 0) {
    throw toolExecutionFailed(`code-runner exitCode=${lastResult.exitCode}`);
  }
  applyVerificationConfidence(stage, runtime);
  return true;
}
