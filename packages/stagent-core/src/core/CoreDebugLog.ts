import * as fs from 'fs';
import { appendDebugLogLine, formatDebugLogLine, sanitizeForLog } from '../WorkflowLogging';
import { appendSessionLogLine, formatSessionLogLine } from '../SessionDebugLog';
import {
  getDefaultTaskDir as getDefaultTaskDirFromPersistence,
} from '../WorkflowPersistence';
import type { PlatformAdapter } from '../platform/PlatformAdapter';
import type { WorkflowInstance } from '../WorkflowDefinition';

export interface CoreDebugLogDeps {
  platform: PlatformAdapter;
  getInstance(): WorkflowInstance | undefined;
  getInstanceKey(): string | undefined;
  warn(message: string): void;
}

export interface CoreDebugLogApi {
  debugLog(stageId: string, event: string, attempt: number, payload?: unknown): void;
  sessionLog(purpose: string, event: string, payload?: unknown): void;
  llmTraceLog(traceStageId: string, event: string, payload?: unknown): void;
  logUserAction(kind: string, detail: Record<string, unknown>): void;
  ensureTaskDir(instanceKey: string): string;
}

export function createCoreDebugLog(deps: CoreDebugLogDeps): CoreDebugLogApi {
  function ensureTaskDir(instanceKey: string): string {
    const inst = deps.getInstance();
    if (!inst) {
      return getDefaultTaskDirFromPersistence(
        instanceKey,
        deps.platform.paths.workspaceRoot(),
        deps.platform.paths.globalStorageDir(),
      );
    }
    if (!inst.taskDir) {
      inst.taskDir = getDefaultTaskDirFromPersistence(
        instanceKey,
        deps.platform.paths.workspaceRoot(),
        deps.platform.paths.globalStorageDir(),
      );
    }
    fs.mkdirSync(inst.taskDir, { recursive: true });
    return inst.taskDir;
  }

  function appendDebugLine(line: string): void {
    const key = deps.getInstanceKey();
    if (!deps.getInstance() || !key) {
      return;
    }
    try {
      appendDebugLogLine(ensureTaskDir(key), line);
    } catch (e) {
      deps.warn(`debug_log_append_failed err=${String(e)}`);
    }
  }

  function debugLog(stageId: string, event: string, attempt: number, payload?: unknown): void {
    const traceId = deps.getInstance()?.traceId ?? 'trace-missing';
    const line = formatDebugLogLine(traceId, stageId, event, attempt, sanitizeForLog(payload));
    appendDebugLine(line);
  }

  function sessionLog(purpose: string, event: string, payload?: unknown): void {
    try {
      appendSessionLogLine(
        deps.platform.paths.globalStorageDir(),
        formatSessionLogLine(purpose, event, payload),
      );
    } catch (e) {
      deps.warn(`session_log_append_failed err=${String(e)}`);
    }
  }

  function llmTraceLog(traceStageId: string, event: string, payload?: unknown): void {
    if (deps.getInstance() && deps.getInstanceKey()) {
      debugLog(traceStageId, event, 0, payload);
    } else {
      sessionLog(traceStageId, event, payload);
    }
  }

  function logUserAction(kind: string, detail: Record<string, unknown>): void {
    const stageId = typeof detail.stageId === 'string' ? detail.stageId : 'workflow';
    debugLog(stageId, 'user_action', 0, { kind, ...detail });
  }

  return { debugLog, sessionLog, llmTraceLog, logUserAction, ensureTaskDir };
}
