import type { LlmInvokeOpts } from '../core/LlmInvokeOpts';
import type * as vscode from '../platform/HostTypes';
import type { WorkflowDefinition } from '../WorkflowDefinition';

/** 工作流生成、润色缓存与 JSON 解析。 */
export interface GenerationHostDeps {
  getPolishCache: () => Map<string, { text: string; polishedAt: string }>;
  polishCacheKey: (draft: string, taskType: string, polishTier: 'light' | 'standard') => string;
  rememberPolishCache: (cacheKey: string, text: string, polishedAt: string) => void;
  ensurePreExecDraftShell: (opts: {
    phase: 'polish' | 'clarify' | 'generate';
    userInput?: string;
    taskType: string;
    taskWorkspacePathRaw?: string;
  }) => string | undefined;
  finalizeDraftDefinition: (wf: WorkflowDefinition) => string | undefined;
  invokeLlmRaw: (
    systemPrompt: string,
    userContent: string,
    panel: vscode.WebviewPanel,
    traceStageId: string,
    opts?: LlmInvokeOpts,
  ) => Promise<string>;
  parseWorkflowJson: (
    raw: string,
    panel: vscode.WebviewPanel,
    onAuxLlmOutput?: (text: string) => void,
    maxOutputTokens?: number,
  ) => Promise<WorkflowDefinition>;
  normalizeWorkflow: (wf: WorkflowDefinition, userInput: string, taskType: string) => WorkflowDefinition;
  isGenerationSuperseded: (myGen: number) => boolean;
  resolveReuseInstance: (instanceKey?: string) => {
    reuse: boolean;
    existing?: import('../WorkflowDefinition').WorkflowInstance;
    instanceId: string;
  };
}
