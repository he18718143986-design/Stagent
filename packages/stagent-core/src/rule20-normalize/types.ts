import type { Stage } from '../WorkflowDefinition';
import { hasStageOutputSource } from '../workflow/StageInputSources';
import {
  decideStageIdFromSemanticName,
  isDecideStageId,
  isGlobalArchitectureDecideStageId,
  semanticNameFromImplStageId,
} from '../workflow/StageIdPatterns';

export const IMPL_DECISION_CONSTRAINT_SNIPPET = '严格按照已确认的决策清单实现，不得偏离。';

/** 引擎插入的全局架构决策阶段固定 id（与 SPEC §7.8 / Prompt 推荐一致）。 */
export { GLOBAL_ARCHITECTURE_DECIDE_STAGE_ID } from '../workflow/StageIdPatterns';

export { GLOBAL_ARCH_DECIDE_STAGE_ID_PATTERN as GLOBAL_ARCH_DECIDE_ID } from '../workflow/StageIdPatterns';

export interface Rule20StructuralNormalizeOptions {
  /** vscode `stagent.autoInsertGlobalArchitectureDecision`；默认 false */
  autoInsertGlobalArchitectureDecision?: boolean;
  /** M25-F2：将 stage_zoom_out 从 file-read 升级为 llm-text + 词汇表 */
  upgradeZoomOut?: boolean;
  zoomOutGlossaryHint?: string;
}

export function findGlobalArchitectureDecisionStage(stages: Stage[]): Stage | undefined {
  return (
    stages.find((s) => s.isDecisionStage === true && isGlobalArchitectureDecideStageId(s.id)) ??
    stages.find((s) => s.isDecisionStage === true && isDecideStageId(s.id))
  );
}

export function implSemanticNameFromImplStageId(implStageId: string): string | undefined {
  return semanticNameFromImplStageId(implStageId);
}

export function pairedDecideStageIdForImpl(implStageId: string): string {
  const sem = semanticNameFromImplStageId(implStageId);
  return sem ? decideStageIdFromSemanticName(sem) : '';
}

export function implHasDecisionRecordSource(stage: Stage): boolean {
  return hasStageOutputSource(stage.input.sources, {
    requireDecideStageId: true,
  });
}

export function implReferencesDecisionRecordFromStage(stage: Stage, decideStageId: string): boolean {
  return hasStageOutputSource(stage.input.sources, { stageId: decideStageId });
}
