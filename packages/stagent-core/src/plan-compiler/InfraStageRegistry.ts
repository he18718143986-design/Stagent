import { STAGE_INIT_NPM_WORKSPACE_ID } from '../disk-bootstrap/constants';
import { isTestRunStageId } from '../workflow/StageIdPatterns';
import { isCodeRunnerTool } from '../workflow/StageToolKinds';
import type { Stage } from '../WorkflowDefinition';
import { codeRunnerCommandOf } from '../plan-completeness/planCompletenessStageAccess';

/** 引擎 bootstrap/self-heal 幂等注入的 infra 阶段 id（LLM 不得保留）。 */
export const INFRA_STAGE_IDS = new Set([
  STAGE_INIT_NPM_WORKSPACE_ID,
  'stage_npm_install_server',
  'stage_venv_create',
  'stage_ensure_requirements_baseline',
  'stage_venv_pip_install',
  'stage_venv_import_check',
  'stage_venv_init',
  'stage_impl_conftest',
]);

const INFRA_COMMAND_PATTERNS = [
  /\bnpm\s+init\b/i,
  /\bnpm\s+install\b/i,
  /\bpython3?\s+-m\s+venv\b/i,
  /\.venv\/bin\/pip\b/i,
  /\bpip\s+install\b/i,
];

/** LLM 误写的 venv python；合法 `stage_test_run_*` 在 venv 链之后可使用。 */
const VENV_PYTHON_COMMAND = /\.venv\/bin\/python\b/i;

export function isLlmInfraStage(stage: Stage): boolean {
  if (INFRA_STAGE_IDS.has(stage.id)) {
    return true;
  }
  if (stage.id.includes('verify_server')) {
    return true;
  }
  if (!isCodeRunnerTool(stage.tool)) {
    return false;
  }
  const cmd = codeRunnerCommandOf(stage) ?? '';
  if (INFRA_COMMAND_PATTERNS.some((re) => re.test(cmd))) {
    return true;
  }
  if (!isTestRunStageId(stage.id) && VENV_PYTHON_COMMAND.test(cmd)) {
    return true;
  }
  return false;
}
