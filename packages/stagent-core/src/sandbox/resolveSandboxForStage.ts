import { SMOKE_RUN_STAGE_ID } from '../disk-bootstrap/smokeStage';
import type { CodeRunnerConfig } from '../WorkflowDefinition';
import { isTestRunStageId } from '../workflow/StageIdPatterns';

export interface SandboxStagePolicy {
  sandboxEnabled: boolean;
  /** 为 true 时仅 test_run / smoke 走沙箱（B-Q2 轻量加固）。 */
  verificationOnly: boolean;
}

/** B-Q2：按阶段决定是否用沙箱执行 code-runner。 */
export function shouldSandboxCodeRunner(
  stageId: string,
  _cfg: CodeRunnerConfig,
  policy: SandboxStagePolicy,
): boolean {
  if (!policy.sandboxEnabled) {
    return false;
  }
  if (!policy.verificationOnly) {
    return true;
  }
  return isTestRunStageId(stageId) || stageId === SMOKE_RUN_STAGE_ID;
}
