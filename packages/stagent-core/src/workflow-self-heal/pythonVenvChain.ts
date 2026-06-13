/** Re-export shim：venv 链逻辑已迁至 contract-infra（InfraChain SSOT）。 */
export type { PythonVenvChainStatus } from '../contract-infra';
export {
  firstPythonInfraAnchorIndex as firstPythonTestRunIndex,
  planDeclaresRequirementsTxt,
  pythonVenvChainComplete,
  pythonVenvChainStatusBefore,
  resolveVenvPipInstallCommand,
} from '../contract-infra';

import type { WorkflowDefinition } from '../WorkflowDefinition';
import { isTestRunStageId } from '../workflow/StageIdPatterns';
import { isCodeRunnerTool } from '../workflow/StageToolKinds';
import { codeRunnerCommandOf } from '../plan-completeness/planCompletenessStageAccess';

/** @deprecated 使用 firstPythonInfraAnchorIndex */
export function planUsesPytest(stages: WorkflowDefinition['stages']): boolean {
  return (stages ?? []).some((s) => {
    if (!isTestRunStageId(s.id) || !isCodeRunnerTool(s.tool)) {
      return false;
    }
    return /\b(pytest|\.venv\/bin\/pytest)\b/i.test(codeRunnerCommandOf(s) ?? '');
  });
}
