import type * as vscode from '../platform/HostTypes';
import type { WorkflowEngineArtifactFacade } from './WorkflowEngineFacades';
import type { WorkflowEngineDiagnostics } from '../WorkflowEngineDiagnostics';
import type { WorkflowInstanceManager } from '../WorkflowInstanceManager';
import { applyOutputEdit } from '../WorkflowEngineOutputEdit';
import type { WorkflowEngineHostRegistry } from '../WorkflowEngineHostRegistry';
import {
  copyRecentDebugLogAction,
  copyRecentSessionLogAction,
  openArtifactDiffAction,
  openArtifactFileAction,
  openDebugLogAction,
} from '../WorkflowArtifactUi';

export interface WorkflowArtifactFacadeDeps {
  context: vscode.ExtensionContext;
  hostRegistry: WorkflowEngineHostRegistry;
  instanceManager: WorkflowInstanceManager;
  diagnostics: WorkflowEngineDiagnostics;
}

export class WorkflowArtifactFacadeImpl implements WorkflowEngineArtifactFacade {
  constructor(private readonly deps: WorkflowArtifactFacadeDeps) {}

  openArtifactFile(stageId: string, filePath: string): Promise<void> {
    return openArtifactFileAction(this.deps.hostRegistry.artifactUiHost(), stageId, filePath);
  }

  openArtifactDiff(stageId: string, filePath: string): Promise<void> {
    return openArtifactDiffAction(this.deps.hostRegistry.artifactUiHost(), stageId, filePath);
  }

  copyRecentDebugLog(): Promise<void> {
    return copyRecentDebugLogAction(this.deps.hostRegistry.artifactUiHost());
  }

  copyRecentSessionLog(): Promise<void> {
    return copyRecentSessionLogAction(
      this.deps.context.globalStorageUri?.fsPath ?? this.deps.context.storagePath ?? '',
    );
  }

  openDebugLog(): Promise<void> {
    return openDebugLogAction(this.deps.hostRegistry.artifactUiHost());
  }

  editOutput(stageId: string, outputKey: string, newContent: unknown): void {
    applyOutputEdit(this.deps.instanceManager, this.deps.diagnostics, stageId, outputKey, newContent);
  }
}
