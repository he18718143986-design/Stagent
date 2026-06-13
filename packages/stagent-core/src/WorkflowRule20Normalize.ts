/**
 * Re-export shim：Rule20 结构归一化已拆分至 rule20-normalize/*。
 */
export type { Rule20StructuralNormalizeOptions } from './rule20-normalize';
export {
  IMPL_DECISION_CONSTRAINT_SNIPPET,
  GLOBAL_ARCHITECTURE_DECIDE_STAGE_ID,
  findGlobalArchitectureDecisionStage,
  implSemanticNameFromImplStageId,
  pairedDecideStageIdForImpl,
  implHasDecisionRecordSource,
  implReferencesDecisionRecordFromStage,
  fixTestRunStagesMustUseCodeRunner,
  upgradeZoomOutStageToLlmText,
  buildGlobalArchitectureDecisionStageShell,
  insertGlobalArchitectureDecisionShellIfNeeded,
  buildAutoInsertedGlobalArchitectureWarningLine,
  wireSoftwareImplDecisionSources,
  ensureAllSoftwareImplConstraintPrompts,
  wireOrphanImplStagesToGlobalArchitectureDecision,
  applyRule20StructuralNormalizations,
} from './rule20-normalize';
