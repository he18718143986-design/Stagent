/**
 * Re-export shim：生成后校验管线已拆分至 generation-validation/*。
 */
export type {
  GenerationGateSettings,
  GenerationValidationOutcome,
  OrchestratePostParseValidationParams,
} from './generation-validation';
export { runPostParseValidationPipeline } from './generation-validation';
export type { PlanSummary, StageSourceEdge } from './WorkflowPlanSummary';
export type { StructuralRepairAction } from './WorkflowStructuralRepair';
