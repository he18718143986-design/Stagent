import type { PlatformAdapter } from '../platform/PlatformAdapter';
import type { HostExtensionContext, HostGlobalState } from '../platform/HostTypes';

class PlatformGlobalState implements HostGlobalState {
  constructor(private readonly adapter: PlatformAdapter) {}
  get<T>(key: string): T | undefined {
    return this.adapter.state.get<T>(key);
  }
  async update(key: string, value: unknown): Promise<void> {
    this.adapter.state.set(key, value);
  }
  keys(): readonly string[] {
    return this.adapter.state.keys();
  }
}

export function buildHostExtensionContext(adapter: PlatformAdapter): HostExtensionContext {
  const globalStorageDir = adapter.paths.globalStorageDir();
  return {
    globalState: new PlatformGlobalState(adapter),
    storagePath: globalStorageDir,
    globalStorageUri: { fsPath: globalStorageDir },
    extensionUri: { fsPath: globalStorageDir },
  };
}
