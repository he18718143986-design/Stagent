import type * as vscode from './platform/HostTypes';
import { getMergedExecEnv } from './process/shellEnvironment';
import type { BackendMessage, CodeRunnerConfig } from './WorkflowDefinition';
import {
  resolveCodeRunnerCwd,
  runCodeRunnerCommand,
  type CodeRunnerExecutionOptions,
} from './WorkflowCodeRunnerHost';
import {
  readEngineSandboxEnabled,
  readEngineSandboxVerificationOnly,
} from './WorkflowEngineSettingsReaders';
import type { WorkflowEnginePathHost } from './WorkflowEnginePathHost';

export interface StageCodeRunnerDeps {
  getPathHost: () => WorkflowEnginePathHost;
  postMessage: (panel: vscode.WebviewPanel | undefined, msg: BackendMessage) => void;
  warn: (message: string) => void;
}

export class StageCodeRunnerService {
  constructor(private readonly deps: StageCodeRunnerDeps) {}

  resolveCodeRunnerCwd(cfg: CodeRunnerConfig, instanceKey: string): string {
    return resolveCodeRunnerCwd(this.codeRunnerDeps(), cfg, instanceKey);
  }

  runCodeRunner(
    cfg: CodeRunnerConfig,
    instanceKey: string,
    stageId: string,
    panel?: vscode.WebviewPanel,
    opts?: CodeRunnerExecutionOptions,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return runCodeRunnerCommand(this.codeRunnerDeps(panel), cfg, instanceKey, stageId, opts);
  }

  private codeRunnerDeps(panel?: vscode.WebviewPanel) {
    const pathHost = this.deps.getPathHost();
    return {
      ensureTaskDir: (key: string) => pathHost.ensureTaskDir(key),
      getWorkspaceRootAbsolute: () => pathHost.getWorkspaceRootAbsolute(),
      safeJoinUnderWorkspaceRoot: (root: string, rel: string) =>
        pathHost.safeJoinUnderWorkspaceRoot(root, rel),
      resolveTaskFilePath: (key: string, fp: string) => pathHost.resolveTaskFilePath(key, fp),
      postStreamChunk: (sid: string, chunk: string) => {
        if (panel) {
          this.deps.postMessage(panel, { type: 'streamChunk', stageId: sid, chunk });
        }
      },
      warn: (msg: string) => this.deps.warn(msg),
      sandboxEnabled: readEngineSandboxEnabled(),
      sandboxVerificationOnly: readEngineSandboxVerificationOnly(),
      confirmSoftConstraintSandbox: async () => true,
      resolveExecEnv: () => getMergedExecEnv(),
    };
  }
}
