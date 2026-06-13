import type { HostExtensionContext } from './platform/HostTypes';
import type { EngineOutputChannel } from './engine-wiring/EngineRuntimeState';

/** P0-5：Stagent 用户可见 OutputChannel 懒创建（headless：console sink）。 */
export function getOrCreateStagentOutputChannel(
  _context: HostExtensionContext,
  existing?: EngineOutputChannel,
): EngineOutputChannel {
  if (existing) {
    return existing;
  }
  return {
    appendLine: (line: string) => {
      console.log(`[Stagent] ${line}`);
    },
  };
}
