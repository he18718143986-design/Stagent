import type { WorkspaceConfiguration } from '../../platform/HostTypes';
import { resolveLlmMaxOutputTokens, resolveLlmTimeoutSeconds } from '../../LlmInvokeHelpers';
import {
  readConfigBooleanStrictTrue,
  readConfigResolved,
} from './readConfigHelpers';

/** vscode `stagent.llmTimeoutSeconds` → 毫秒 */
export function readLlmTimeoutMs(cfg?: WorkspaceConfiguration): number {
  return readConfigResolved(
    cfg,
    'llmTimeoutSeconds',
    (raw) => resolveLlmTimeoutSeconds(raw) * 1000,
    resolveLlmTimeoutSeconds(undefined) * 1000,
  );
}

/** vscode `stagent.llmMaxOutputTokens` → Direct API 请求体 max_tokens */
export function readLlmMaxOutputTokens(cfg?: WorkspaceConfiguration): number {
  return readConfigResolved(
    cfg,
    'llmMaxOutputTokens',
    resolveLlmMaxOutputTokens,
    resolveLlmMaxOutputTokens(undefined),
  );
}

/** vscode `stagent.debugVerbose`；默认 false */
export function readDebugVerbose(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanStrictTrue(cfg, 'debugVerbose');
}
