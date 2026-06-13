import type { DecisionProvenance } from './CharterTypes';
import type { WorkflowInstance } from '../WorkflowDefinition';

export interface CharterCoverageMetrics {
  /** 已完成决策阶段总数 */
  decisionStages: number;
  /** 含 decisionProvenance 的决策阶段数 */
  tagged: number;
  human: number;
  charter_direct: number;
  charter_inferred: number;
  escalated: number;
  /** (charter_direct + charter_inferred) / decisionStages；无决策阶段时为 0 */
  coverageRate: number;
}

function bump(counts: Record<DecisionProvenance, number>, p: DecisionProvenance): void {
  counts[p] += 1;
}

/** B-R4：从实例 stageRuntimes 统计 Charter 代答覆盖率。 */
export function computeCharterCoverageMetrics(instance: WorkflowInstance): CharterCoverageMetrics {
  const counts: Record<DecisionProvenance, number> = {
    human: 0,
    charter_direct: 0,
    charter_inferred: 0,
    escalated: 0,
  };
  let decisionStages = 0;
  let tagged = 0;

  for (let i = 0; i < instance.definition.stages.length; i++) {
    const stage = instance.definition.stages[i];
    if (stage.isDecisionStage !== true) {
      continue;
    }
    const rt = instance.stageRuntimes[i];
    if (!rt || rt.status !== 'done') {
      continue;
    }
    decisionStages += 1;
    const p = rt.decisionProvenance;
    if (p) {
      tagged += 1;
      bump(counts, p);
    } else {
      counts.human += 1;
      tagged += 1;
    }
  }

  const answered = counts.charter_direct + counts.charter_inferred;
  const coverageRate =
    decisionStages > 0 ? Math.round((answered / decisionStages) * 1000) / 1000 : 0;

  return {
    decisionStages,
    tagged,
    human: counts.human,
    charter_direct: counts.charter_direct,
    charter_inferred: counts.charter_inferred,
    escalated: counts.escalated,
    coverageRate,
  };
}
