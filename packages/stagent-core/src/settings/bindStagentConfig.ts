import type { ConfigPort } from '../platform/PlatformAdapter';
import type { WorkspaceConfiguration } from '../platform/HostTypes';
import { configPortToWorkspaceConfiguration } from './StagentConfigAdapter';

let boundPort: ConfigPort | undefined;
let boundCfg: WorkspaceConfiguration | undefined;

/** 由 createWorkflowEngineParts 在引擎启动时绑定 adapter.config。 */
export function bindStagentConfigPort(port: ConfigPort): void {
  boundPort = port;
  boundCfg = configPortToWorkspaceConfiguration(port);
}

export function getBoundStagentConfigPort(): ConfigPort | undefined {
  return boundPort;
}

export function getBoundStagentConfiguration(): WorkspaceConfiguration | undefined {
  return boundCfg;
}
