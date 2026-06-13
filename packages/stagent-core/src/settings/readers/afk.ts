import type { WorkspaceConfiguration } from '../../platform/HostTypes';
import { readConfigBooleanStrictTrue } from './readConfigHelpers';

/** vscode `stagent.afk.enabled`；B-R4 真无人值守预设（合并 Charter/HITL/验证策略）。 */
export function readAfkEnabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanStrictTrue(cfg, 'afk.enabled');
}

/** 用户是否在任意作用域显式写过该键（AFK 预设不覆盖显式配置）。 */
export function settingExplicitlyConfigured(
  cfg: WorkspaceConfiguration | undefined,
  key: string,
): boolean {
  const inspected = cfg?.inspect?.(key);
  if (!inspected) {
    return false;
  }
  return (
    inspected.globalValue !== undefined ||
    inspected.workspaceValue !== undefined ||
    inspected.workspaceFolderValue !== undefined
  );
}
