/**
 * M38.1：stage_test_run_* 执行前测试栈 preflight（运行期兜底，与 M39.1 生成期门互补）。
 */
import { isTestRunStageId } from './workflow/StageIdPatterns';
import { isCodeRunnerTool } from './workflow/StageToolKinds';
import { codeRunnerCommandOf } from './workflow/StageToolConfigAccess';
import type { Stage } from './WorkflowDefinition';
import {
  isJsTestRunCommand,
  isPythonOnlyTestRunCommand,
  planSignalsExpoStack,
} from './PlanCompletenessGate';
import type { WorkflowDefinition } from './WorkflowDefinition';
import { diskSignalsExpoStack } from './test-infra/expoSignals';
import { discoverTestInfraOnDisk, scanTestInfraOnDisk } from './test-infra/diskScan';
import { buildMissingTestInfraIssue } from './test-infra/missingInfraIssue';
import { discoverPythonTestInfraOnDisk } from './test-infra/pythonDiskScan';
import { buildMissingPythonTestInfraIssue } from './test-infra/missingPythonInfraIssue';
import { resolveEffectiveCodeRunnerCwd } from './code-runner/effectiveCwd';

export type TestRunPreflightIssue =
  | NonNullable<ReturnType<typeof buildMissingTestInfraIssue>>
  | NonNullable<ReturnType<typeof buildMissingPythonTestInfraIssue>>;

export { diskSignalsExpoStack, discoverTestInfraOnDisk, scanTestInfraOnDisk };

const PYTEST_CMD = /\b(pytest|\.venv\/bin\/pytest)\b/i;

/** 是否应对该阶段做 Python pytest preflight。 */
export function stageNeedsPythonTestRunPreflight(stage: Stage): boolean {
  if (!isCodeRunnerTool(stage.tool) || !isTestRunStageId(stage.id)) {
    return false;
  }
  const cmd = codeRunnerCommandOf(stage) ?? '';
  return isPythonOnlyTestRunCommand(cmd) || PYTEST_CMD.test(cmd);
}

/** 是否应对该阶段做 test_run preflight（JS 或 Python）。 */
export function stageNeedsTestRunPreflight(stage: Stage): boolean {
  if (!isCodeRunnerTool(stage.tool) || !isTestRunStageId(stage.id)) {
    return false;
  }
  const cmd = codeRunnerCommandOf(stage);
  if (!cmd) {
    return false;
  }
  if (stageNeedsPythonTestRunPreflight(stage)) {
    return true;
  }
  return isJsTestRunCommand(cmd) || /\b(jest|vitest|npm\s+test)\b/i.test(cmd);
}

/**
 * 将 code-runner 的 shell cwd 与命令里的 `cd <dir>` 对齐，供 M38.1 扫描真实测试目录。
 * 例：cwd=workspace 根 + `cd server && npm test` → `<root>/server`（jest.config 常在此）。
 */
/** @deprecated 使用 resolveEffectiveCodeRunnerCwd；保留别名供测试与外部引用。 */
export function resolveTestRunPreflightCwd(params: {
  workspaceRoot: string;
  codeRunnerCwd: string;
  command: string;
}): string {
  return resolveEffectiveCodeRunnerCwd({
    workspaceRoot: params.workspaceRoot,
    baseCwd: params.codeRunnerCwd,
    command: params.command,
  });
}

function lintPythonTestRunPreflightOnDisk(params: {
  workspaceRoot: string;
  cwd: string;
  stage: Stage;
}): TestRunPreflightIssue | null {
  const cmd = codeRunnerCommandOf(params.stage) ?? '';
  const effectiveCwd = resolveTestRunPreflightCwd({
    workspaceRoot: params.workspaceRoot,
    codeRunnerCwd: params.cwd,
    command: cmd,
  });
  const discovery = discoverPythonTestInfraOnDisk(effectiveCwd);
  return buildMissingPythonTestInfraIssue(discovery, { autoFixConftest: true });
}

/** 运行期 preflight：检查 cwd / workspaceRoot 上是否已有 M39.1 要求的测试配置文件。 */
export function lintTestRunPreflightOnDisk(params: {
  workspaceRoot: string;
  cwd: string;
  stage: Stage;
  /** 可选：用于 Expo 计划信号（生成期 wf 仍可用时更准确）。 */
  workflow?: WorkflowDefinition;
}): TestRunPreflightIssue | null {
  const { workspaceRoot, cwd, stage, workflow } = params;
  if (!stageNeedsTestRunPreflight(stage)) {
    return null;
  }
  if (stageNeedsPythonTestRunPreflight(stage)) {
    return lintPythonTestRunPreflightOnDisk({ workspaceRoot, cwd, stage });
  }
  const cmd = codeRunnerCommandOf(stage) ?? '';
  const effectiveCwd = resolveTestRunPreflightCwd({ workspaceRoot, codeRunnerCwd: cwd, command: cmd });
  const discovery = discoverTestInfraOnDisk(workspaceRoot, effectiveCwd);
  const expo =
    (workflow ? planSignalsExpoStack(workflow) : false) ||
    diskSignalsExpoStack(workspaceRoot, effectiveCwd, stage);
  return buildMissingTestInfraIssue(expo, discovery.merged, discovery);
}
