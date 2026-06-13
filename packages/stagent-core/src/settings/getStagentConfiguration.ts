import type { WorkspaceConfiguration } from '../platform/HostTypes';
import { getBoundStagentConfiguration } from './bindStagentConfig';

const FALLBACK: WorkspaceConfiguration = {
  get<T>(_key: string, defaultValue?: T): T | undefined {
    return defaultValue;
  },
  has: () => false,
};

/** `stagent` 工作区配置；可选注入 cfg 便于单测。未绑定时返回空配置（全默认值）。 */
export function getStagentConfiguration(cfg?: WorkspaceConfiguration): WorkspaceConfiguration {
  return cfg ?? getBoundStagentConfiguration() ?? FALLBACK;
}
