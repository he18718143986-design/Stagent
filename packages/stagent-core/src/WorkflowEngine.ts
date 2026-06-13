import type { PlatformAdapter } from './platform/PlatformAdapter';
import type { HostPanel } from './platform/HostTypes';
import type { BackendMessage, FrontendMessage, WorkflowDefinition, WorkflowInstance } from './WorkflowDefinition';
import type { WorkflowUiBridge } from './WorkflowUiBridge';
import type { DeleteScope } from './WorkflowDeletePlan';
import type { TaskListItem } from './WorkflowInstanceQuery';
import { createWorkflowEngineParts } from './engine-wiring/createWorkflowEngineParts';
import type {
  WorkflowEngineArtifactFacade,
  WorkflowEngineExecutionFacade,
  WorkflowEngineGenerationFacade,
  WorkflowEngineHitlFacade,
  WorkflowEngineInstanceFacade,
} from './engine-facades/WorkflowEngineFacades';

export class WorkflowEngine {
  private readonly core: ReturnType<typeof createWorkflowEngineParts>['core'];
  private readonly ui: WorkflowUiBridge;
  /** @internal tests / IPC introspection */
  readonly platform: PlatformAdapter;
  readonly instances: WorkflowEngineInstanceFacade;
  readonly generation: WorkflowEngineGenerationFacade;
  readonly execution: WorkflowEngineExecutionFacade;
  readonly hitl: WorkflowEngineHitlFacade;
  readonly artifacts: WorkflowEngineArtifactFacade;

  constructor(platform: PlatformAdapter) {
    this.platform = platform;
    const parts = createWorkflowEngineParts(platform);
    this.core = parts.core;
    this.ui = parts.ui;
    parts.lifecycle?.setInstancesChangedListener(undefined);
    this.instances = parts.facades.instances;
    this.generation = parts.facades.generation;
    this.execution = parts.facades.execution;
    this.hitl = parts.facades.hitl;
    this.artifacts = parts.facades.artifacts;
  }

  private activePanel(): HostPanel | undefined {
    return this.ui.getActivePanel();
  }

  postMessage(msg: BackendMessage): void {
    this.core.postMessage(msg);
  }

  setInstancesChangedListener(listener: (() => void) | undefined): void {
    this.core.setInstancesChangedListener(listener);
  }

  getActiveInstanceKey(): string | undefined {
    return this.instances.getActiveInstanceKey();
  }

  isExecutionInFlight(): boolean {
    return this.execution.isExecutionInFlight();
  }

  pruneStaleGlobalInstances(): void {
    this.instances.pruneStaleGlobalInstances();
  }

  getRecoverableInstanceKeys(): string[] {
    return this.instances.getRecoverableInstanceKeys();
  }

  async resumeInstance(instanceKey: string): Promise<{ ok: boolean; error?: string }> {
    const ok = await this.instances.resumeInstance(instanceKey, this.activePanel());
    return { ok, error: ok ? undefined : 'resume-failed' };
  }

  getTaskSummaries(): WorkflowInstance[] {
    return this.instances.getTaskSummaries();
  }

  getTaskListItems(): TaskListItem[] {
    return this.instances.getTaskListItems();
  }

  deleteInstance(instanceKey: string, scope: DeleteScope = 'record'): void {
    this.instances.deleteInstance(instanceKey, scope);
  }

  async polishUserTask(draft: string, taskType: string, taskWorkspacePathRaw?: string): Promise<void> {
    return this.generation.polishUserTask(draft, taskType, this.activePanel(), taskWorkspacePathRaw);
  }

  async generateClarifyQuestions(userInput: string, taskType: string, taskWorkspacePathRaw: string): Promise<void> {
    return this.generation.generateClarifyQuestions(
      userInput,
      taskType,
      taskWorkspacePathRaw,
      this.activePanel(),
    );
  }

  async generateWorkflow(
    userInput: string,
    taskType: string,
    taskWorkspacePathRaw: string,
    polishContext?: { originalDraft: string; polishedAt: string },
    clarifyAnswers?: Record<string, string>,
  ): Promise<void> {
    return this.generation.generateWorkflow(
      userInput,
      taskType,
      this.activePanel(),
      taskWorkspacePathRaw,
      polishContext,
      clarifyAnswers,
    );
  }

  async startExecution(workflowOverride?: WorkflowDefinition, instanceKey?: string): Promise<void> {
    return this.execution.startExecution(this.activePanel(), workflowOverride, instanceKey);
  }

  async executeNextStage(): Promise<void> {
    return this.execution.executeNextStage(this.activePanel());
  }

  getPreferredModelFamily(): string {
    return this.execution.getPreferredModelFamily();
  }

  setPreferredModelFamily(modelFamily: string): void {
    this.execution.setPreferredModelFamily(modelFamily);
  }

  getCurrentStageInfo() {
    return this.instances.getCurrentStageInfo();
  }

  getDecisionReviewContext(stageId: string) {
    return this.core.getDecisionReviewContext(stageId);
  }

  async approve(stageId: string): Promise<void> {
    return this.hitl.approve(stageId);
  }

  async approveDecision(stageId: string, decisionRecord: string): Promise<void> {
    return this.hitl.approveDecision(stageId, decisionRecord);
  }

  async answerQuestions(stageId: string, answers: Record<string, string>): Promise<void> {
    return this.hitl.answerQuestions(stageId, answers);
  }

  async answerQuestionsBefore(stageId: string, answers: Record<string, string>): Promise<void> {
    return this.hitl.answerQuestionsBefore(stageId, answers);
  }

  async retry(stageId: string, comment: string): Promise<void> {
    await this.hitl.retry(stageId, comment);
  }

  async openArtifactFile(stageId: string, filePath: string): Promise<void> {
    return this.artifacts.openArtifactFile(stageId, filePath);
  }

  async openArtifactDiff(stageId: string, filePath: string): Promise<void> {
    return this.artifacts.openArtifactDiff(stageId, filePath);
  }

  async copyRecentDebugLog(): Promise<void> {
    return this.artifacts.copyRecentDebugLog();
  }

  async copyRecentSessionLog(): Promise<void> {
    return this.artifacts.copyRecentSessionLog();
  }

  editOutput(stageId: string, outputKey: string, newContent: unknown): void {
    this.artifacts.editOutput(stageId, outputKey, newContent);
  }
}

export function isFrontendMessage(msg: unknown): msg is FrontendMessage {
  return typeof msg === 'object' && msg !== null && 'type' in msg;
}
