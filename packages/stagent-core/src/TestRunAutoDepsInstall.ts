/**
 * test_run 前自动 npm install（effective cwd 内检测 package.json / node_modules）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveEffectiveCodeRunnerCwd } from './code-runner/effectiveCwd';
import { codeRunnerCommandOf } from './workflow/StageToolConfigAccess';
import type { CodeRunnerConfig, Stage, WorkflowInstance } from './WorkflowDefinition';
import { stageNeedsTestRunPreflight } from './TestRunPreflight';

const DEPS_INSTALL_STAGE_PREFIX = 'stage_deps_install_';

export function isDepsInstallStageId(stageId: string): boolean {
  return stageId.startsWith(DEPS_INSTALL_STAGE_PREFIX);
}

/** package.json 存在且 node_modules 缺失或落后于 package.json 时需安装。 */
export function needsNpmInstallInDir(dir: string): boolean {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return false;
  }
  const nodeModulesPath = path.join(dir, 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) {
    return true;
  }
  try {
    const pkgMtime = fs.statSync(pkgPath).mtimeMs;
    const nmMtime = fs.statSync(nodeModulesPath).mtimeMs;
    return pkgMtime > nmMtime;
  } catch {
    return true;
  }
}

export function hasCompletedDepsInstallBefore(
  instance: WorkflowInstance,
  testRunStageIndex: number,
): boolean {
  for (let i = testRunStageIndex - 1; i >= 0; i--) {
    const s = instance.definition.stages[i]!;
    if (!isDepsInstallStageId(s.id)) {
      continue;
    }
    const rt = instance.stageRuntimes[i];
    return rt?.status === 'done';
  }
  return false;
}

export function resolveTestRunEffectiveCwd(params: {
  workspaceRoot: string;
  baseCwd: string;
  stage: Stage;
}): string {
  const cmd = codeRunnerCommandOf(params.stage) ?? '';
  return resolveEffectiveCodeRunnerCwd({
    workspaceRoot: params.workspaceRoot,
    baseCwd: params.baseCwd,
    command: cmd,
  });
}

export function shouldAutoNpmInstallBeforeTestRun(params: {
  stage: Stage;
  instance: WorkflowInstance;
  stageIndex: number;
  effectiveCwd: string;
}): boolean {
  if (!stageNeedsTestRunPreflight(params.stage)) {
    return false;
  }
  if (hasCompletedDepsInstallBefore(params.instance, params.stageIndex)) {
    return false;
  }
  return needsNpmInstallInDir(params.effectiveCwd);
}

export function relativeDirFromWorkspace(workspaceRoot: string, effectiveCwd: string): string {
  const rel = path.relative(path.resolve(workspaceRoot), path.resolve(effectiveCwd));
  const normalized = rel.replace(/\\/g, '/');
  return normalized || '.';
}

export function buildAutoNpmInstallConfig(
  workspaceRoot: string,
  effectiveCwd: string,
): CodeRunnerConfig {
  return {
    type: 'code-runner',
    command: 'npm install',
    captureOutput: true,
    pathBase: 'workspace',
    workingDir: relativeDirFromWorkspace(workspaceRoot, effectiveCwd),
  };
}
