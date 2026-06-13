import * as fs from 'fs';
import * as path from 'path';
import type { ErrorType, WorkflowInstance } from './WorkflowDefinition';

/** 单行 JSON 字段（SPEC §4.7），写入 `.wf-failures.jsonl`。 */
export interface WorkflowFailureRecord {
  timestamp: string;
  traceId: string;
  stageId: string;
  stageTitle: string;
  tool: string;
  taskType: string;
  errorType: ErrorType;
  errorSummary: string;
  retryCount: number;
  workflowId: string;
}

/** I-12：写入前脱敏（启发式，覆盖常见密钥形态）。 */
export function sanitizeFailureSummary(text: string): string {
  let s = text;
  s = s.replace(/sk-[a-zA-Z0-9]{10,}/gi, '[REDACTED]');
  s = s.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
  s = s.replace(/\bxox[baprs]-[a-zA-Z0-9-]{8,}\b/gi, '[REDACTED]');
  s = s.replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]');
  s = s.replace(/\b(?:password|passwd|pwd|token|secret|api[_-]?key)\s*[=:]\s*\S+/gi, '[REDACTED]');
  s = s.replace(/\b(?:authorization)\s*[=:]\s*\S+/gi, '[REDACTED]');
  return s;
}

export function truncateFailureSummary(text: string, maxChars = 200): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}…`;
}

export function buildWorkflowFailureRecord(
  instance: WorkflowInstance,
  detail: { stageId: string; error: string; errorType: ErrorType },
): WorkflowFailureRecord | null {
  const dir = instance.taskDir?.trim();
  if (!dir) {
    return null;
  }
  const idx = instance.definition.stages.findIndex((st) => st.id === detail.stageId);
  const stage = idx >= 0 ? instance.definition.stages[idx] : undefined;
  const rt = idx >= 0 ? instance.stageRuntimes[idx] : undefined;
  const summary = truncateFailureSummary(sanitizeFailureSummary(detail.error));
  return {
    timestamp: new Date().toISOString(),
    traceId: instance.traceId ?? 'trace-missing',
    stageId: detail.stageId,
    stageTitle: stage?.title ?? detail.stageId,
    tool: stage?.tool ?? 'unknown',
    taskType: instance.definition.meta.taskType,
    errorType: detail.errorType,
    errorSummary: summary,
    retryCount: rt?.retryCount ?? 0,
    workflowId: instance.definition.id,
  };
}

export function appendWorkflowFailureJsonl(
  taskDir: string,
  record: WorkflowFailureRecord,
  warn: (message: string) => void,
): void {
  try {
    const filePath = path.join(taskDir, '.wf-failures.jsonl');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf-8');
  } catch (e) {
    warn(`wf-failures append failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * 集中式失败日志：在 per-task `.wf-failures.jsonl` 之外，向
 * `<globalStorage>/failure-logs/failures.jsonl` 追加同一条记录，
 * 便于运营跨任务聚合高频失败 stageId / errorType。
 */
export function appendGlobalFailureJsonl(
  globalStoragePath: string,
  record: WorkflowFailureRecord,
  warn: (message: string) => void,
): void {
  try {
    const dir = path.join(globalStoragePath, 'failure-logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'failures.jsonl'), `${JSON.stringify(record)}\n`, 'utf-8');
  } catch (e) {
    warn(`global failures append failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
