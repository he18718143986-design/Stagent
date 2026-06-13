/** Re-export shim：决策阶段不变式已迁至 workflow/DecisionStageShape.ts。 */
export {
  DECISION_STAGE_INVARIANT_I1_MSG,
  ensureDecisionStageOutput,
  ensureSoftwareWorkflowHasDecisionStage,
  normalizeDecisionStage,
  validateDecisionStageInvariants,
} from '../workflow/DecisionStageShape';
