/**
 * Re-export shim：结构修补已拆分至 structural-repair/*。
 */
export type {
  StructuralRepairPathConfidence,
  StructuralRepairAction,
  StructuralRepairResult,
  PlanStructuralRepairMode,
  ApplyStructuralRepairOptions,
} from './structural-repair';
export {
  STAGENT_REPAIR_STAGE_ID_PREFIX,
  STAGENT_REPAIR_MARKER,
  parseTestRunWorkingDir,
  inferTestInfraDirectory,
  repairMissingVerificationStage,
  repairMissingTestInfrastructure,
  repairMissingSelfHealChain,
  structuralRepairWarningLines,
  formatStructuralRepairBlockReason,
  applyPlanCompletenessStructuralRepairs,
  applyPostLintStructuralRepairs,
  isStagentRepairStage,
} from './structural-repair';
