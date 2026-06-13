import type { ConfigPort } from '../platform/PlatformAdapter';
import type { WorkspaceConfiguration } from '../platform/HostTypes';

/** 将 PlatformAdapter.config 适配为 HostTypes.WorkspaceConfiguration。 */
export function configPortToWorkspaceConfiguration(port: ConfigPort): WorkspaceConfiguration {
  return {
    get<T>(key: string, defaultValue?: T): T | undefined {
      if (defaultValue !== undefined) {
        return port.get(key, defaultValue);
      }
      return port.get<T>(key);
    },
    has: (_key: string) => true,
  };
}
