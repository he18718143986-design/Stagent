import type { Stage, WorkflowDefinition } from '../../WorkflowDefinition';
import type { StructuralRepairAction } from '../types';
import {
  firstTestRunStageIndex,
  planSignalsExpoStack,
  testInfrastructureArtifactsBefore,
} from '../../PlanCompletenessGate';
import { inferTestInfraDirectory } from '../helpers';
import { buildBabelConfigStage, buildJestConfigStage } from './jest-babel-config';

export function repairMissingTestInfrastructure(
  wf: WorkflowDefinition,
): { workflow: WorkflowDefinition; action?: StructuralRepairAction } {
  const idx = firstTestRunStageIndex(wf);
  if (idx < 0) {
    return { workflow: wf };
  }
  const existing = testInfrastructureArtifactsBefore(wf, idx);
  const expo = planSignalsExpoStack(wf);
  const needJest = !existing.jest;
  const needBabel = expo && !existing.babel;
  if (!needJest && !needBabel) {
    return { workflow: wf };
  }

  const { dir, pathConfidence } = inferTestInfraDirectory(wf, idx);
  const toInsert: Stage[] = [];
  if (needJest) {
    toInsert.push(buildJestConfigStage(wf, dir, pathConfidence, expo));
  }
  if (needBabel) {
    toInsert.push(buildBabelConfigStage(wf, dir, pathConfidence));
  }

  const stages = [...(wf.stages ?? [])];
  stages.splice(idx, 0, ...toInsert);
  const stageIds = toInsert.map((s) => s.id);
  return {
    workflow: { ...wf, stages },
    action: {
      source: 'plan-completeness',
      code: 'missing-test-infrastructure',
      action: 'insert-stage',
      stageIds,
      pathConfidence,
      message:
        pathConfidence === 'high'
          ? `在首个 test_run 前插入 ${stageIds.join('、')}（目录 ${dir || '.'}）`
          : `在首个 test_run 前插入 ${stageIds.join('、')}（路径待本阶段执行时确定）`,
    },
  };
}
