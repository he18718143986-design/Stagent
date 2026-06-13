import type { WorkflowDefinition } from '../WorkflowDefinition';
import { isTestRunStageId, isTestWriteStageId } from '../workflow/StageIdPatterns';
import { injectSelfHealStages } from '../workflow-self-heal/injectSelfHealStages';
import { injectPythonConftestStage } from './pythonConftestStage';
import { injectDeliveryWrapupStage } from './deliveryWrapupStage';
import { augmentTestRunToWorkspaceRoot } from './testRunAugment';

function workflowHasTddChain(stages: WorkflowDefinition['stages']): boolean {
  return (stages ?? []).some((s) => isTestWriteStageId(s.id) || isTestRunStageId(s.id));
}

/** prototype：交付收口 +（有 TDD 链时）自修复注入，对齐 software 的 self-heal 闸门。 */
export function applyPrototypeDiskPipeline(wf: WorkflowDefinition): WorkflowDefinition {
  const stages = injectDeliveryWrapupStage(wf.stages ?? []);
  if (!workflowHasTddChain(stages)) {
    return { ...wf, stages };
  }
  const withConftest = injectPythonConftestStage({ ...wf, stages });
  const { workflow } = injectSelfHealStages(withConftest);
  augmentTestRunToWorkspaceRoot(workflow.stages);
  return workflow;
}
