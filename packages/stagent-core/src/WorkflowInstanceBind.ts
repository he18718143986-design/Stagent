import type { WorkflowStatus } from './WorkflowDefinition';
import { shouldIgnoreStaleWebviewSession } from './InstanceSession';

/** @deprecated 使用 InstanceSession.resolveSessionForAction / shouldIgnoreStaleWebviewSession */
export function shouldUseEngineInstanceDespiteStaleWebviewKey(
  engineKey: string | undefined,
  webviewKey: string | undefined,
  instanceStatus: WorkflowStatus,
  executionDepth: number,
): boolean {
  return shouldIgnoreStaleWebviewSession(engineKey, webviewKey, instanceStatus, executionDepth);
}
