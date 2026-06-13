/** VS Code `globalState` 中工作流实例条目的键名前缀与解析。 */
export const WF_INSTANCE_KEY_PREFIX = 'wf_instance_';

export function globalStateKeyForInstance(instanceKey: string): string {
  return `${WF_INSTANCE_KEY_PREFIX}${instanceKey}`;
}

export function parseInstanceKeyFromGlobalStateKey(key: string): string | undefined {
  if (!isWorkflowInstanceGlobalStateKey(key)) {
    return undefined;
  }
  return key.slice(WF_INSTANCE_KEY_PREFIX.length);
}

export function isWorkflowInstanceGlobalStateKey(key: string): boolean {
  return key.startsWith(WF_INSTANCE_KEY_PREFIX);
}
