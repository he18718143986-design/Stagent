import type { WorkflowDefinition } from '../WorkflowDefinition';
import { buildDraftShellDeps, type EngineHostFactoryDeps } from '../WorkflowEngineHostFactories';
import {
  ensurePreExecDraftShell as ensurePreExecDraftShellFromModule,
  finalizeDraftDefinition as finalizeDraftDefinitionFromModule,
} from '../WorkflowDraftShell';

export class InstanceDraftFacade {
  constructor(private readonly hostFactoryDeps: () => EngineHostFactoryDeps) {}

  ensurePreExecDraftShell(opts: {
    phase: 'polish' | 'clarify' | 'generate';
    userInput?: string;
    taskType: string;
    taskWorkspacePathRaw?: string;
  }): string | undefined {
    return ensurePreExecDraftShellFromModule(buildDraftShellDeps(this.hostFactoryDeps()), opts);
  }

  finalizeDraftDefinition(wf: WorkflowDefinition): string | undefined {
    return finalizeDraftDefinitionFromModule(buildDraftShellDeps(this.hostFactoryDeps()), wf);
  }
}
