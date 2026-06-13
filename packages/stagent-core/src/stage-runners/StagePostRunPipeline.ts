import type { ExecuteNextStageLoopParams } from '../WorkflowExecutorTypes';

export interface StagePostRunContext {
  params: ExecuteNextStageLoopParams;
  stage: import('../WorkflowDefinition').Stage;
  runtime: import('../WorkflowDefinition').StageRuntime;
  instance: import('../WorkflowDefinition').WorkflowInstance;
  effectivePauseAfter: boolean;
  outKey: string;
  attempt: number;
  contractNode: boolean;
}

export { finalizeStageAfterToolRun } from './post-run/finalizeStageAfterToolRun';
