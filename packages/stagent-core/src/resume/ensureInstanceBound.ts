import type { WebviewPanel } from '../platform/HostTypes';
import { resolveSessionForAction } from '../InstanceSession';
import { syncInstanceStagePosition } from '../WorkflowStagePosition';
import { tryActivateInstance } from './activateInstance';
import { uiMsg } from '../l10n/uiStrings';
import type { ResumeCoordinatorHost } from './types';

/** Webview 用户操作前确保引擎已绑定实例（扩展重载后 webview 可能仍显示暂停栏）。 */
export function ensureInstanceBound(
  host: ResumeCoordinatorHost,
  instanceKey: string | undefined,
  panel: WebviewPanel,
): boolean {
  const webviewSessionId = instanceKey;
  if (host.getInstance()) {
    const resolved = resolveSessionForAction({
      activeSessionId: host.getCurrentInstanceKey(),
      activeInstance: host.getInstance(),
      webviewSessionId,
      executionDepth: host.getExecutionDepth(),
    });
    if (resolved.kind === 'use-active' || resolved.kind === 'stale-webview-ignored') {
      if (resolved.kind === 'stale-webview-ignored') {
        host.warn(
          `ensureInstanceBound: stale webview sessionId=${resolved.webviewSessionId} using engine sessionId=${resolved.sessionId}`,
        );
      }
      return true;
    }
  }
  const key = webviewSessionId ?? host.getCurrentInstanceKey();
  if (!key) {
    host.warn(uiMsg('stagent.warn.instanceNotBound'));
    return false;
  }
  const loaded = host.loadInstanceByKey(key);
  if (!loaded) {
    host.warn(uiMsg('stagent.warn.instanceNotFound'));
    return false;
  }
  const activated = tryActivateInstance(host, key, loaded, panel, { pushRecoveryUi: true });
  if (!activated.ok) {
    host.warn(uiMsg('stagent.warn.reason', activated.reason));
    return false;
  }
  syncInstanceStagePosition(host.getInstance()!);
  return true;
}
