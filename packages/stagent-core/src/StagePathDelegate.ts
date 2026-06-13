import type { ToolPathBase } from './WorkflowDefinition';
import type { WorkflowEnginePathHost } from './WorkflowEnginePathHost';

export interface StagePathDelegateDeps {
  getPathHost: () => WorkflowEnginePathHost;
  getInstance: () => { definition: { globalConfig?: { dagMaxParallelism?: number } } } | undefined;
  readDagMaxParallelism: (globalConfig: { dagMaxParallelism?: number } | undefined) => number;
}

export class StagePathDelegate {
  constructor(private readonly deps: StagePathDelegateDeps) {}

  ensureTaskDir(instanceKey: string): string {
    return this.deps.getPathHost().ensureTaskDir(instanceKey);
  }

  resolveTaskFilePath(instanceKey: string, filePath: string): string {
    return this.deps.getPathHost().resolveTaskFilePath(instanceKey, filePath);
  }

  resolveOutputPath(instanceKey: string, filePath: string, base: ToolPathBase = 'instance'): string {
    return this.deps.getPathHost().resolveOutputPath(instanceKey, filePath, base);
  }

  resolveReadableFilePath(instanceKey: string, filePath: string): string {
    return this.deps.getPathHost().resolveReadableFilePath(instanceKey, filePath);
  }

  resolveDagMaxParallelismForInstance(): number {
    const inst = this.deps.getInstance();
    if (!inst) {
      return 1;
    }
    return this.deps.readDagMaxParallelism(inst.definition.globalConfig);
  }

  getWorkspaceRootAbsolute(): string | undefined {
    return this.deps.getPathHost().getWorkspaceRootAbsolute();
  }
}
