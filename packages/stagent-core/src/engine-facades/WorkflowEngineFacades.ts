import type { DeleteScope } from '../WorkflowDeletePlan';
import type { TaskListItem } from '../WorkflowInstanceQuery';
import type { BackendMessage, WorkflowDefinition, WorkflowInstance } from '../WorkflowDefinition';
import type { HostPanel } from '../platform/HostTypes';
import type { HitlRetryResult } from '../hitl/HitlRetryResult';

export type WorkflowStageProgressInfo = {
  instanceTitle: string;
  stageId: string;
  stageName: string;
  stageIndex: number;
  stageTotal: number;
  status: string;
};

export interface WorkflowEngineGenerationFacade {
  polishUserTask(draft: string, taskType: string, panel?: HostPanel, taskWorkspacePathRaw?: string): Promise<void>;
  generateClarifyQuestions(userInput: string, taskType: string, taskWorkspacePathRaw: string, panel?: HostPanel): Promise<void>;
  generateWorkflow(userInput: string, taskType: string, panel?: HostPanel, taskWorkspacePathRaw?: string, polishContext?: { originalDraft: string; polishedAt: string }, clarifyAnswers?: Record<string, string>): Promise<void>;
}

export interface WorkflowEngineInstanceFacade {
  getTaskListItems(): TaskListItem[];
  getTaskSummaries(): WorkflowInstance[];
  deleteInstance(instanceKey: string, scope?: DeleteScope): void;
  resumeInstance(instanceKey: string, panel?: HostPanel): Promise<boolean>;
  getRecoverableInstanceKeys(): string[];
  pruneStaleGlobalInstances(): void;
  getActiveInstanceKey(): string | undefined;
  getActiveInstance(): WorkflowInstance | undefined;
  getCurrentStageInfo(): WorkflowStageProgressInfo | undefined;
}

export interface WorkflowEngineExecutionFacade {
  startExecution(panel?: HostPanel, workflowOverride?: WorkflowDefinition, instanceKey?: string): Promise<void>;
  executeNextStage(panel?: HostPanel): Promise<void>;
  isExecutionInFlight(): boolean;
  getPreferredModelFamily(): string;
  setPreferredModelFamily(modelFamily: string): void;
}

export interface WorkflowEngineHitlFacade {
  approve(stageId: string, panel?: HostPanel): Promise<void>;
  approveDecision(stageId: string, decisionRecord: string, panel?: HostPanel, instanceKey?: string): Promise<void>;
  answerQuestions(stageId: string, answers: Record<string, string>, panel?: HostPanel): Promise<void>;
  answerQuestionsBefore(stageId: string, answers: Record<string, string>, panel?: HostPanel): Promise<void>;
  retry(stageId: string, comment: string, panel?: HostPanel): Promise<HitlRetryResult>;
}

export interface WorkflowEngineArtifactFacade {
  openArtifactFile(stageId: string, filePath: string): Promise<void>;
  openArtifactDiff(stageId: string, filePath: string): Promise<void>;
  copyRecentDebugLog(): Promise<void>;
  copyRecentSessionLog(): Promise<void>;
  editOutput(stageId: string, outputKey: string, newContent: unknown): void;
}
