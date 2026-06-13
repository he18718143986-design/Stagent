import { appendDebugLogLine, formatDebugLogLine, sanitizeForLog } from './WorkflowLogging';
import { appendSessionLogLine, formatSessionLogLine } from './SessionDebugLog';
import { WORKFLOW_LEVEL_STAGE_ID } from './workflow/WorkflowLevelIds';
import { DEBUG_EVENT_DEGRADED, DEBUG_EVENT_USER_ACTION } from './DebugLogEvents';
import type { EngineOutputChannel } from './engine-wiring/EngineRuntimeState';

export interface WorkflowEngineDiagnosticsDeps {
  getActiveInstanceKey: () => string | undefined;
  getTraceId: () => string | undefined;
  ensureTaskDir: (key: string) => string;
  getOrCreateOutputChannel: () => EngineOutputChannel;
  getGlobalStoragePath: () => string;
}

/** 引擎横切日志：OutputChannel、.wf-debug.log、session log。 */
export class WorkflowEngineDiagnostics {
  constructor(private readonly deps: WorkflowEngineDiagnosticsDeps) {}

  warn(message: string): void {
    console.warn(`[Stagent] ${message}`);
    this.deps.getOrCreateOutputChannel().appendLine(`[warn] ${message}`);
    this.persistDiagnostic('warn', message);
  }

  degraded(reason: string, context?: Record<string, unknown>): void {
    const traceId = this.deps.getTraceId() ?? 'trace-missing';
    const payload = { reason, traceId, ...context };
    console.warn(`[Stagent] degraded: ${reason}`);
    this.deps.getOrCreateOutputChannel().appendLine(`[degraded] ${reason}`);
    this.persistDiagnostic('degraded', reason, payload);
    this.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_DEGRADED, 0, payload);
  }

  error(message: string): void {
    console.error(`[Stagent] ${message}`);
    this.deps.getOrCreateOutputChannel().appendLine(`[error] ${message}`);
    this.persistDiagnostic('error', message);
  }

  private persistDiagnostic(event: string, message: string, extra?: Record<string, unknown>): void {
    try {
      const dir = this.deps.getGlobalStoragePath();
      const traceId = this.deps.getTraceId();
      const payload = extra ? { message, traceId, ...extra } : { message, traceId };
      appendSessionLogLine(
        dir,
        formatSessionLogLine('diagnostics', event, payload),
      );
    } catch {
      /* silent */
    }
  }

  debugLog(stageId: string, event: string, attempt: number, payload?: unknown): void {
    const traceId = this.deps.getTraceId() ?? 'trace-missing';
    const line = formatDebugLogLine(traceId, stageId, event, attempt, sanitizeForLog(payload));
    this.appendDebugLine(line, { stageId, event, attempt, traceId, payload });
  }

  logUserAction(kind: string, detail: Record<string, unknown>): void {
    const stageId = typeof detail.stageId === 'string' ? detail.stageId : WORKFLOW_LEVEL_STAGE_ID;
    this.debugLog(stageId, DEBUG_EVENT_USER_ACTION, 0, { kind, ...detail });
  }

  flushMetrics(_reason: string): void {}

  sessionLog(purpose: string, event: string, payload?: unknown): void {
    const dir = this.deps.getGlobalStoragePath();
    try {
      appendSessionLogLine(dir, formatSessionLogLine(purpose, event, payload));
    } catch (e) {
      this.warn(`session-log-failed ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private appendDebugLine(
    line: string,
    fallbackMeta?: { stageId: string; event: string; attempt: number; traceId: string; payload?: unknown },
  ): void {
    const key = this.deps.getActiveInstanceKey();
    if (!key) {
      if (fallbackMeta) {
        try {
          appendSessionLogLine(
            this.deps.getGlobalStoragePath(),
            formatSessionLogLine('debug-fallback', fallbackMeta.event, {
              stageId: fallbackMeta.stageId,
              attempt: fallbackMeta.attempt,
              traceId: fallbackMeta.traceId,
              payload: sanitizeForLog(fallbackMeta.payload),
            }),
          );
        } catch (e) {
          this.warn(`debug-fallback-session-log-failed ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return;
    }
    try {
      const dir = this.deps.ensureTaskDir(key);
      appendDebugLogLine(dir, line);
    } catch (e) {
      this.warn(`debug_log_append_failed err=${String(e)}`);
    }
  }
}
