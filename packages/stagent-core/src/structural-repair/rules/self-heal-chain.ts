import type { WorkflowDefinition } from '../../WorkflowDefinition';
import type { StructuralRepairAction } from '../types';
import { auditSelfHealGaps, injectSelfHealStages } from '../../workflow-self-heal/injectSelfHealStages';

export function repairMissingSelfHealChain(wf: WorkflowDefinition): {
  workflow: WorkflowDefinition;
  action?: StructuralRepairAction;
} {
  const gaps = auditSelfHealGaps(wf);
  if (gaps.length === 0) {
    return { workflow: wf };
  }
  const { workflow, insertedStageIds, movedStageIds } = injectSelfHealStages(wf);
  const stageIds = [...insertedStageIds, ...movedStageIds];
  if (stageIds.length === 0) {
    return { workflow: wf };
  }
  return {
    workflow,
    action: {
      source: 'plan-completeness',
      code: 'missing-self-heal-chain',
      action: 'insert-stage',
      stageIds,
      pathConfidence: 'high',
      message: `补齐自修复链：${gaps.join('；')}`,
    },
  };
}
