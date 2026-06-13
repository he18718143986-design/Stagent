import type { WorkflowInstance } from '../WorkflowDefinition';

export interface DecisionReviewContext {
  instanceTitle: string;
  taskType?: string;
  userInput?: string;
  stageTitle: string;
  stageDescription?: string;
  upstreamDecisions: { stageId: string; summary: string }[];
}

export function getDecisionReviewContext(
  inst: WorkflowInstance | undefined,
  stageId: string,
): DecisionReviewContext | undefined {
  if (!inst) {
    return undefined;
  }
  const stageIdx = inst.definition.stages.findIndex((s) => s.id === stageId);
  if (stageIdx < 0) {
    return undefined;
  }
  const stage = inst.definition.stages[stageIdx];
  const upstreamDecisions: { stageId: string; summary: string }[] = [];
  for (let i = 0; i < stageIdx; i += 1) {
    const rt = inst.stageRuntimes[i];
    const record = (rt as { decisionRecord?: string }).decisionRecord;
    if (typeof record === 'string' && record.trim()) {
      upstreamDecisions.push({
        stageId: rt.stageId,
        summary: record.trim().slice(0, 280),
      });
    }
  }
  return {
    instanceTitle: inst.definition.meta.title,
    taskType: inst.definition.meta.taskType,
    userInput: inst.definition.meta.userInput,
    stageTitle: stage.title,
    stageDescription: stage.description,
    upstreamDecisions,
  };
}
