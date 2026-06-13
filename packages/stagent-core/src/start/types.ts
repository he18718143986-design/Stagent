import type { WebviewPanel } from '../platform/HostTypes';
import type { BackendMessage, WorkflowDefinition, WorkflowInstance } from '../WorkflowDefinition';

export interface StartExecutionHost {
  bindPanel(panel: WebviewPanel): void;
  postMessage(panel: WebviewPanel, msg: BackendMessage): void;
  normalizeWorkflow(wf: WorkflowDefinition, userInput: string, taskType: string): WorkflowDefinition;
  resolveReuseInstance(instanceKey?: string): {
    reuse: boolean;
    existing?: WorkflowInstance;
    instanceId: string;
  };
  getCurrentInstanceKey(): string | undefined;
  setCurrentInstanceKey(key: string): void;
  getExecutionDepth(): number;
  getInstance(): WorkflowInstance | undefined;
  setInstance(instance: WorkflowInstance): void;
  clearSaveTimer(): void;
  persistInstanceSnapshot(key: string, inst: WorkflowInstance): void;
  resolveInitialTaskDirForStart(
    instanceId: string,
    wf: WorkflowDefinition,
  ): { ok: true; dir: string } | { ok: false; reason: string };
  expandUserHomePath(raw: string): string;
  clearExperiencePersistedFlag(): void;
  debugLog(stageId: string, event: string, attempt: number, payload?: unknown): void;
  writeProcessDocs(wf: WorkflowDefinition, taskDir: string): void;
  persistMilestone(): void;
  scheduleSave(): void;
  executeNextStage(panel: WebviewPanel): Promise<void>;
}
