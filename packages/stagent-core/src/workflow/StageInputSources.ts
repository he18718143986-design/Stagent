import type { InputSource } from '../WorkflowDefinition';
import { PRIMARY_DECISION_OUTPUT_KEY } from '../WorkflowOutputKeys';
import { isDecideStageId } from './StageIdPatterns';

export interface StageOutputSourceQuery {
  /** 默认 `PRIMARY_DECISION_OUTPUT_KEY`。 */
  outputKey?: string;
  /** 精确匹配 `stageId`。 */
  stageId?: string;
  /** Rule20 严格模式：须为 decide 阶段 id。 */
  requireDecideStageId?: boolean;
  /** PlanSummary 宽模式：须为非空 `stageId`（不要求 decide 前缀）。 */
  requireNonEmptyStageId?: boolean;
  /** Prototype lint：stageId 须在已知 decision 列表内（undefined stageId 视为匹配）。 */
  allowedStageIds?: readonly string[];
}

function matchesStageOutputSource(source: InputSource, q: StageOutputSourceQuery): boolean {
  if (source.type !== 'stage-output') {
    return false;
  }
  const outputKey = q.outputKey ?? PRIMARY_DECISION_OUTPUT_KEY;
  if (source.outputKey !== outputKey) {
    return false;
  }
  if (q.stageId !== undefined && source.stageId !== q.stageId) {
    return false;
  }
  const sid = source.stageId ?? '';
  if (q.requireDecideStageId && !isDecideStageId(sid)) {
    return false;
  }
  if (q.requireNonEmptyStageId && sid.trim().length === 0) {
    return false;
  }
  if (q.allowedStageIds !== undefined) {
    const allowed = q.allowedStageIds;
    if (source.stageId !== undefined && !allowed.includes(source.stageId)) {
      return false;
    }
  }
  return true;
}

export function filterStageOutputSources(
  sources: InputSource[],
  q: StageOutputSourceQuery,
): InputSource[] {
  return sources.filter((s) => matchesStageOutputSource(s, q));
}

export function hasStageOutputSource(sources: InputSource[], q: StageOutputSourceQuery): boolean {
  return sources.some((s) => matchesStageOutputSource(s, q));
}

export function implHasDecisionRecordSourceStrict(sources: InputSource[]): boolean {
  return hasStageOutputSource(sources, { requireDecideStageId: true });
}

export function implHasDecisionRecordSourcePlanWide(sources: InputSource[]): boolean {
  return hasStageOutputSource(sources, { requireNonEmptyStageId: true });
}

export function implHasDecisionRecordSourceForStages(
  sources: InputSource[],
  decisionStageIds: readonly string[],
): boolean {
  return hasStageOutputSource(sources, { allowedStageIds: decisionStageIds });
}
