import { isTestRunStageId } from '../workflow/StageIdPatterns';
import { isCodeRunnerTool } from '../workflow/StageToolKinds';
import type { WorkflowDefinition } from '../WorkflowDefinition';
import { planSignalsExpoStack } from '../test-infra/expoSignals';
import { testInfraSatisfied } from '../test-infra/artifacts';
import { parseTestRunWorkingDir } from '../structural-repair/helpers';
import { lintMsg } from '../l10n/lintMsg';
import {
  codeImplStages,
  JS_TEST_RUN_CMD,
  matchesMainAssemblyCommand,
  PYTHON_TEST_RUN_CMD,
} from './mainAssemblyChecks';
import {
  codeRunnerCommandOf,
  stageDeclaresTestInfra,
  TS_JSX_CODE_EXT,
  writeOutputToFileOf,
} from './planCompletenessStageAccess';
import type { PlanCompletenessIssue } from './planCompletenessTypes';

export { EXPO_STACK_HINT } from '../test-infra/constants';
export { planSignalsExpoStack } from '../test-infra/expoSignals';

export function isJsTestRunCommand(cmd: string): boolean {
  const trimmed = cmd.trim();
  return !!trimmed && JS_TEST_RUN_CMD.test(trimmed) && !matchesMainAssemblyCommand(trimmed);
}

export function isPythonOnlyTestRunCommand(cmd: string): boolean {
  const trimmed = cmd.trim();
  return !!trimmed && PYTHON_TEST_RUN_CMD.test(trimmed) && !JS_TEST_RUN_CMD.test(trimmed);
}

export function firstTestRunStageIndex(wf: WorkflowDefinition): number {
  const stages = wf.stages ?? [];
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i]!;
    if (isTestRunStageId(s.id)) {
      return i;
    }
    if (isCodeRunnerTool(s.tool)) {
      const cmd = codeRunnerCommandOf(s);
      if (cmd && JS_TEST_RUN_CMD.test(cmd) && !matchesMainAssemblyCommand(cmd)) {
        return i;
      }
    }
  }
  return -1;
}

export function hasTypeScriptOrJsxCodeImpls(wf: WorkflowDefinition): boolean {
  return codeImplStages(wf).some((s) => TS_JSX_CODE_EXT.test(writeOutputToFileOf(s)));
}

export function testInfrastructureArtifactsBefore(
  wf: WorkflowDefinition,
  endIndex: number,
): { jest: boolean; babel: boolean; tsconfig: boolean } {
  const acc = { jest: false, babel: false, tsconfig: false };
  const stages = wf.stages ?? [];
  const bound = Math.max(0, Math.min(endIndex, stages.length));
  for (let i = 0; i < bound; i++) {
    const part = stageDeclaresTestInfra(stages[i]!);
    if (part.jest) {
      acc.jest = true;
    }
    if (part.babel) {
      acc.babel = true;
    }
    if (part.tsconfig) {
      acc.tsconfig = true;
    }
  }
  return acc;
}

export function planRequiresTestInfrastructure(wf: WorkflowDefinition): boolean {
  const idx = firstTestRunStageIndex(wf);
  if (idx < 0) {
    return false;
  }
  const stages = wf.stages ?? [];
  const testCmd = codeRunnerCommandOf(stages[idx]!);
  const jsRunner = JS_TEST_RUN_CMD.test(testCmd);
  const pyOnly =
    !hasTypeScriptOrJsxCodeImpls(wf) &&
    (PYTHON_TEST_RUN_CMD.test(testCmd) ||
      codeImplStages(wf).every((s) => /\.py$/i.test(writeOutputToFileOf(s))));
  if (pyOnly && !jsRunner) {
    return false;
  }
  if (jsRunner) {
    return true;
  }
  if (hasTypeScriptOrJsxCodeImpls(wf)) {
    return true;
  }
  return false;
}

export function hasTestInfrastructureBeforeFirstTestRun(wf: WorkflowDefinition): boolean {
  const idx = firstTestRunStageIndex(wf);
  if (idx <= 0) {
    return idx < 0;
  }
  const artifacts = testInfrastructureArtifactsBefore(wf, idx);
  return testInfraSatisfied(planSignalsExpoStack(wf), artifacts);
}

function normalizePlanDir(dir: string): string {
  return dir.replace(/\\/g, '/').replace(/\/+$/, '');
}

function dirnameOfWritePath(file: string): string {
  const n = file.replace(/\\/g, '/');
  const i = n.lastIndexOf('/');
  if (i <= 0) {
    return '';
  }
  return n.slice(0, i);
}

/** M39.1 路径对齐：test-infra writeOutputToFile 目录须与 test_run `cd` 目标一致。 */
export function lintTestInfraPathAlignment(wf: WorkflowDefinition): PlanCompletenessIssue | null {
  const idx = firstTestRunStageIndex(wf);
  if (idx < 0 || !planRequiresTestInfrastructure(wf)) {
    return null;
  }
  const testStage = wf.stages[idx]!;
  const testCmd = codeRunnerCommandOf(testStage) ?? '';
  const cdDir = parseTestRunWorkingDir(testCmd);
  if (cdDir === undefined) {
    return null;
  }
  const expectedDir = normalizePlanDir(cdDir);

  for (let i = 0; i < idx; i++) {
    const stage = wf.stages[i]!;
    const file = writeOutputToFileOf(stage);
    if (!file) {
      continue;
    }
    const infra = stageDeclaresTestInfra(stage);
    if (!infra.jest && !infra.babel && !infra.tsconfig) {
      continue;
    }
    const fileDir = normalizePlanDir(dirnameOfWritePath(file));
    if (fileDir !== expectedDir) {
      return {
        type: 'test-infra-path-mismatch',
        message: lintMsg(
          'stagent.planCompleteness.testInfraPathMismatch',
          file,
          expectedDir || '.',
        ),
      };
    }
  }
  return null;
}
