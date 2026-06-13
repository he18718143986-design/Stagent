/**
 * Input 页生成进度 operation（与 WorkflowLevelIds.WORKFLOW_LEVEL_STAGE_ID 字面量相同但语义不同：
 * 此处为 postGenerationProgress / inputBusyOp 的 UI operation，非 debug/Rule20 伪 stageId）。
 */
export const GENERATION_OPERATION_WORKFLOW = 'workflow';
export const GENERATION_OPERATION_POLISH = 'polish';

export type GenerationOperationId =
  | typeof GENERATION_OPERATION_WORKFLOW
  | typeof GENERATION_OPERATION_POLISH;
