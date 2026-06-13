import type { WorkflowDefinition } from '../../WorkflowDefinition';
import type { StructuralRepairAction } from '../types';
import { firstPythonInfraAnchorIndex } from '../../contract-infra';
import { injectPythonVenvChainBeforeTestRun } from '../../workflow-self-heal/injectSelfHealStages';
import { injectPythonConftestStage } from '../../disk-bootstrap/pythonConftestStage';

export function repairMissingPythonVenvChain(wf: WorkflowDefinition): {
  workflow: WorkflowDefinition;
  action?: StructuralRepairAction;
} {
  const anchor = firstPythonInfraAnchorIndex(wf);
  if (anchor < 0) {
    return { workflow: wf };
  }
  const stages = [...(wf.stages ?? [])];
  const result = injectPythonVenvChainBeforeTestRun(stages, anchor);
  if (result.insertedStageIds.length === 0) {
    return { workflow: wf };
  }
  return {
    workflow: { ...wf, stages: result.stages },
    action: {
      source: 'plan-completeness',
      code: 'missing-python-venv-chain',
      action: 'insert-stage',
      stageIds: result.insertedStageIds,
      pathConfidence: 'high',
      message: `补齐 Python venv 链：${result.insertedStageIds.join('、')}`,
    },
  };
}

export function repairMissingPythonTestLayout(wf: WorkflowDefinition): {
  workflow: WorkflowDefinition;
  action?: StructuralRepairAction;
} {
  const next = injectPythonConftestStage(wf);
  const inserted = (next.stages ?? []).filter(
    (s) => !(wf.stages ?? []).some((o) => o.id === s.id),
  );
  if (inserted.length === 0) {
    return { workflow: wf };
  }
  return {
    workflow: next,
    action: {
      source: 'plan-completeness',
      code: 'missing-python-test-layout',
      action: 'insert-stage',
      stageIds: inserted.map((s) => s.id),
      pathConfidence: 'high',
      message: '插入 conftest flat-layout bootstrap 阶段',
    },
  };
}
