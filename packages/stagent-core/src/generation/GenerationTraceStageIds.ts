/** LLM trace stage ids for generation / polish / repair / pre-gen clarify (session debug log purpose). */
export const TRACE_STAGE_WORKFLOW_GEN = 'workflow-gen';
export const TRACE_STAGE_WORKFLOW_GEN_REPAIR = 'workflow-gen-repair';
export const TRACE_STAGE_WORKFLOW_GEN_CONTINUE = 'workflow-gen-continue';
export const TRACE_STAGE_TASK_POLISH = 'task-polish';
export const TRACE_STAGE_CLARIFY_QUESTIONS = 'clarify-questions';

export const GENERATION_TRACE_STAGE_IDS = [
  TRACE_STAGE_WORKFLOW_GEN,
  TRACE_STAGE_WORKFLOW_GEN_REPAIR,
  TRACE_STAGE_WORKFLOW_GEN_CONTINUE,
  TRACE_STAGE_TASK_POLISH,
  TRACE_STAGE_CLARIFY_QUESTIONS,
] as const;

export type GenerationTraceStageId = (typeof GENERATION_TRACE_STAGE_IDS)[number];

export function isGenerationTraceStageId(stageId: string): boolean {
  return (GENERATION_TRACE_STAGE_IDS as readonly string[]).includes(stageId);
}
