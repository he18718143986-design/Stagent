import { isTestRunStageId } from '../workflow/StageIdPatterns';
import { isCodeRunnerTool } from '../workflow/StageToolKinds';
import type { WorkflowDefinition } from '../WorkflowDefinition';
import { codeImplStages } from '../plan-completeness/mainAssemblyChecks';
import {
  codeRunnerCommandOf,
  writeOutputToFileOf,
} from '../plan-completeness/planCompletenessStageAccess';
import { isJsTestRunCommand, isPythonOnlyTestRunCommand } from '../plan-completeness/testInfraChecks';

const PY_IMPL_EXT = /\.py$/i;
const PYTEST_CMD = /\b(pytest|\.venv\/bin\/pytest)\b/i;
const NODE_IMPL_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
function workflowGlobalLanguageIsPython(wf: WorkflowDefinition): boolean {
  const lang = wf.globalConfig?.language;
  return typeof lang === 'string' && lang.trim().toLowerCase() === 'python';
}

/** test_run 使用 pytest / python -m pytest 等 Python 测试命令。 */
export function workflowSignalsPythonTestStack(wf: WorkflowDefinition): boolean {
  return (wf.stages ?? []).some((s) => {
    if (!isTestRunStageId(s.id) || !isCodeRunnerTool(s.tool)) {
      return false;
    }
    const cmd = codeRunnerCommandOf(s) ?? '';
    return isPythonOnlyTestRunCommand(cmd) || PYTEST_CMD.test(cmd);
  });
}

/** 计划中出现 Jest/npm test、TS/JS 落盘或 server npm install 等 Node 栈信号。 */
export function workflowSignalsNodeJsStack(wf: WorkflowDefinition): boolean {
  for (const s of wf.stages ?? []) {
    if (isTestRunStageId(s.id) && isCodeRunnerTool(s.tool)) {
      const cmd = codeRunnerCommandOf(s) ?? '';
      if (isJsTestRunCommand(cmd)) {
        return true;
      }
    }
  }
  for (const s of codeImplStages(wf)) {
    const file = writeOutputToFileOf(s) ?? '';
    if (NODE_IMPL_EXT.test(file)) {
      return true;
    }
  }
  return false;
}

/** 工作流是否以 Python 实现 + pytest 为主（无 TS/JS 测试栈）。 */
export function isPythonOnlyWorkflow(wf: WorkflowDefinition): boolean {
  if (workflowSignalsNodeJsStack(wf)) {
    return false;
  }
  if (workflowSignalsPythonTestStack(wf)) {
    return true;
  }
  if (workflowGlobalLanguageIsPython(wf)) {
    return true;
  }
  const impls = codeImplStages(wf);
  if (impls.length === 0) {
    return false;
  }
  const allPyImpls = impls.every((s) => PY_IMPL_EXT.test(writeOutputToFileOf(s) ?? ''));
  return allPyImpls;
}

/** post test_write / workspace lint 选 test-quality adapter 的语言（ADR-0005 PR-3）。 */
export function resolveTestQualityLanguage(wf: WorkflowDefinition | undefined): 'python' | 'node' {
  if (wf && workflowSignalsNodeJsStack(wf)) {
    return 'node';
  }
  return 'python';
}

export function planDeclaresConftest(wf: WorkflowDefinition): boolean {
  for (const stage of wf.stages ?? []) {
    const out = writeOutputToFileOf(stage)?.replace(/\\/g, '/').toLowerCase() ?? '';
    if (out === 'conftest.py' || out.endsWith('/conftest.py')) {
      return true;
    }
  }
  return false;
}
