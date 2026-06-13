/* HostTypes — 替代 vscode 命名空间的平台宿主类型 */

export type HostPanel = unknown;

export interface HostGlobalState {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Promise<void>;
  keys(): readonly string[];
}

export interface HostUri {
  readonly fsPath: string;
}

export interface HostExtensionContext {
  readonly globalState: HostGlobalState;
  readonly storagePath?: string;
  readonly globalStorageUri?: HostUri;
  readonly extensionUri?: HostUri;
}

export interface WorkspaceConfigurationInspect {
  globalValue?: unknown;
  workspaceValue?: unknown;
  workspaceFolderValue?: unknown;
}

export interface WorkspaceConfiguration {
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  has(key: string): boolean;
  inspect?(key: string): WorkspaceConfigurationInspect | undefined;
}

export namespace vscode {
  export type WebviewPanel = HostPanel;
  export type ExtensionContext = HostExtensionContext;
  export type OutputChannel = { appendLine(line: string): void };
  export type Uri = { fsPath: string };
  export type WorkspaceConfiguration = import('./HostTypes').WorkspaceConfiguration;
}

export type WebviewPanel = HostPanel;
export type ExtensionContext = HostExtensionContext;
