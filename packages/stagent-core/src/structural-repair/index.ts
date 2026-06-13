export type {
  StructuralRepairPathConfidence,
  StructuralRepairAction,
  StructuralRepairResult,
  PlanStructuralRepairMode,
  ApplyStructuralRepairOptions,
} from './types';
export { STAGENT_REPAIR_STAGE_ID_PREFIX, STAGENT_REPAIR_MARKER } from './types';
export { parseTestRunWorkingDir, inferTestInfraDirectory } from './helpers';
export { repairMissingVerificationStage } from './rules/verification-stage';
export { repairMissingTestInfrastructure } from './rules/test-infrastructure';
export { repairMissingSelfHealChain } from './rules/self-heal-chain';
export {
  structuralRepairWarningLines,
  formatStructuralRepairBlockReason,
  applyPlanCompletenessStructuralRepairs,
  applyPostLintStructuralRepairs,
  isStagentRepairStage,
} from './applyStructuralRepairs';
