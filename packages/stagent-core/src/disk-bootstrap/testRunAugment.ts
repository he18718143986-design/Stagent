import type { Stage } from '../WorkflowDefinition';
import { resolveVenvPythonExecutable } from '../contract-infra/InfraChainDetector';
import { codeRunnerCommandOf } from '../plan-completeness/planCompletenessStageAccess';
import { isTestRunStageId } from '../workflow/StageIdPatterns';
import { isCodeRunnerTool } from '../workflow/StageToolKinds';

const PLAIN_PYTEST_CMD = /^python3?\s+-m\s+pytest\b/i;

/** venv 链已注入时，将裸 `python -m pytest` 绑定到工作区 venv（避免 exit 127）。 */
export function augmentTestRunPytestToVenvPython(stages: Stage[]): void {
  if (!stages.some((s) => s.id === 'stage_venv_create')) {
    return;
  }
  const venvPy = resolveVenvPythonExecutable(stages);
  for (const s of stages) {
    if (!isTestRunStageId(s.id) || !isCodeRunnerTool(s.tool)) {
      continue;
    }
    const cmd = codeRunnerCommandOf(s) ?? '';
    if (!/\bpytest\b/i.test(cmd) || /(?:\.venv|venv)\/bin\/python\b/i.test(cmd)) {
      continue;
    }
    const next = cmd.replace(PLAIN_PYTEST_CMD, `${venvPy} -m pytest`);
    if (next !== cmd && s.toolConfig?.type === 'code-runner') {
      (s.toolConfig as { command: string }).command = next;
    }
  }
}

/** 为 stage_test_run_* 的 code-runner 补全 pathBase/workingDir，使测试在工作区根执行。 */
export function augmentTestRunToWorkspaceRoot(stages: Stage[]): void {
  for (const s of stages) {
    if (!isTestRunStageId(s.id) || !isCodeRunnerTool(s.tool)) {
      continue;
    }
    const tc = s.toolConfig as { type: string; pathBase?: string; workingDir?: string };
    if (tc.type !== 'code-runner') {
      continue;
    }
    if (!tc.pathBase) {
      tc.pathBase = 'workspace';
      tc.workingDir = tc.workingDir ?? '.';
    }
  }
  augmentTestRunPytestToVenvPython(stages);
}
