import { isTestRunStageId } from '../workflow/StageIdPatterns';
import { isCodeRunnerTool } from '../workflow/StageToolKinds';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import { isPythonOnlyWorkflow, planDeclaresConftest } from '../python-bootstrap/pythonStackDetect';
import { codeRunnerCommandOf, writeOutputToFileOf } from '../plan-completeness/planCompletenessStageAccess';

const PYTEST_CMD = /\b(pytest|\.venv\/bin\/pytest)\b/i;
const VENV_PYTHON_CMD = /\.venv\/bin\/python\b/i;

function codeRunnerCommand(stage: Stage): string {
  if (!isCodeRunnerTool(stage.tool)) {
    return '';
  }
  return codeRunnerCommandOf(stage) ?? '';
}

/** Python 基础设施锚点：首个需 venv/pytest 的 test_run（与 self-heal 注入条件一致）。 */
export function firstPythonInfraAnchorIndex(wf: WorkflowDefinition): number {
  if (!isPythonOnlyWorkflow(wf)) {
    return -1;
  }
  const stages = wf.stages ?? [];
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i]!;
    if (!isTestRunStageId(s.id)) {
      continue;
    }
    const cmd = codeRunnerCommand(s);
    if (PYTEST_CMD.test(cmd) || VENV_PYTHON_CMD.test(cmd) || cmd.trim().length > 0) {
      return i;
    }
  }
  return -1;
}

export function requiresPythonVenvChain(wf: WorkflowDefinition): boolean {
  return firstPythonInfraAnchorIndex(wf) >= 0;
}

export function requiresPythonConftest(wf: WorkflowDefinition): boolean {
  if (!requiresPythonVenvChain(wf)) {
    return false;
  }
  if (planDeclaresConftest(wf)) {
    return false;
  }
  for (const stage of wf.stages ?? []) {
    const out = writeOutputToFileOf(stage)?.replace(/\\/g, '/').toLowerCase() ?? '';
    if (/^tests\/test_.*\.py$/.test(out) || /\/tests\/test_.*\.py$/.test(out)) {
      const hasPyproject = (wf.stages ?? []).some((s) => {
        const p = writeOutputToFileOf(s)?.toLowerCase() ?? '';
        return p === 'pyproject.toml' || p.endsWith('/pyproject.toml');
      });
      return !hasPyproject;
    }
  }
  return false;
}

export function requiresNpmInstallServer(wf: WorkflowDefinition): boolean {
  if (isPythonOnlyWorkflow(wf)) {
    return false;
  }
  return (wf.stages ?? []).some((s) => isTestRunStageId(s.id));
}

export function firstTestRunIndex(wf: WorkflowDefinition): number {
  return (wf.stages ?? []).findIndex((s) => isTestRunStageId(s.id));
}
