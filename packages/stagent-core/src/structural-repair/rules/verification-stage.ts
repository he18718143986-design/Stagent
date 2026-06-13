import type { WorkflowDefinition } from '../../WorkflowDefinition';
import type { StructuralRepairAction } from '../types';
import { buildRepairCodeRunnerStage } from '../buildRepairStage';

export function repairMissingVerificationStage(wf: WorkflowDefinition): {
  workflow: WorkflowDefinition;
  action?: StructuralRepairAction;
} {
  const stage = buildRepairCodeRunnerStage({
    wf,
    idPrefix: 'stage_test_run_stagent_verify',
    title: '可执行验证',
    descriptionDetail: '自动插入：补齐可执行验证阶段',
    command: 'npm test',
  });
  const stages = [...(wf.stages ?? []), stage];
  return {
    workflow: { ...wf, stages },
    action: {
      source: 'plan-completeness',
      code: 'missing-verification-stage',
      action: 'insert-stage',
      stageIds: [stage.id],
      pathConfidence: 'high',
      message: '在计划末尾插入 stage_test_run_stagent_verify（npm test）',
    },
  };
}
