import type { WorkflowInstance } from './WorkflowDefinition';

export interface PathHostDeps {
  getInstance: () => WorkflowInstance | undefined;
  getCurrentInstanceKey: () => string | undefined;
  getDefaultTaskDir: (instanceId: string) => string;
  getVscodeWorkspaceFolder: () => string | undefined;
  warn: (message: string) => void;
  debugLog: (stageId: string, event: string, attempt: number, payload?: unknown) => void;
  trackPersistedFile: (input: {
    stageId: string;
    outputKey: string;
    filePath: string;
    content: string;
    existedBefore: boolean;
    priorContent?: string;
  }) => void;
}
