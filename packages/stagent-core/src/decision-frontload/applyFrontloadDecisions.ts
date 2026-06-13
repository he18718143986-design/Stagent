import type { StageRuntime } from '../WorkflowDefinition';
import { PRIMARY_DECISION_OUTPUT_KEY } from '../WorkflowOutputKeys';
import type { FrontloadDecisionResolution } from './DecisionFrontloadTypes';

/** 将确认页批准的决策预写入 runtime（status=done，线性调度器将跳过执行）。 */
export function applyFrontloadDecisionsToRuntimes(
  runtimes: StageRuntime[],
  resolutions: FrontloadDecisionResolution[],
): string[] {
  const applied: string[] = [];
  const now = new Date().toISOString();
  for (const res of resolutions) {
    const record = res.decisionRecord.trim();
    if (!record) {
      continue;
    }
    const rt = runtimes.find((r) => r.stageId === res.stageId);
    if (!rt) {
      continue;
    }
    rt.approvedDecisionRecord = record;
    rt.decisionProvenance = res.provenance;
    rt.decisionSource = 'frontload';
    rt.outputs[PRIMARY_DECISION_OUTPUT_KEY] = record;
    rt.status = 'done';
    rt.completedAt = now;
    applied.push(res.stageId);
  }
  return applied;
}
