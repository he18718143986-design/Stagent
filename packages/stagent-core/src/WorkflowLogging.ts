import * as fs from 'fs';
import * as path from 'path';

/** 调试日志字段名脱敏：勿用宽泛子串（如 `key`），否则会误伤 `outputKey`、`monkey` 等键名。 */
function isSensitiveLogFieldName(field: string): boolean {
  const k = field.toLowerCase();
  if (['password', 'passwd', 'pwd', 'secret', 'token', 'authorization', 'apikey', 'api_key'].includes(k)) {
    return true;
  }
  if (k.endsWith('_secret') || k.endsWith('_token')) {
    return true;
  }
  if (k === 'privatekey' || k.includes('private_key')) {
    return true;
  }
  if (/^(?:client|refresh|access|id)_token$/i.test(field)) {
    return true;
  }
  return false;
}

export function sanitizeForLog(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeForLog(v));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveLogFieldName(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitizeForLog(v);
      }
    }
    return out;
  }
  return value;
}

export function formatDebugLogLine(
  traceId: string,
  stageId: string,
  event: string,
  attempt: number,
  payload?: unknown,
): string {
  const safePayload = payload === undefined ? '' : JSON.stringify(sanitizeForLog(payload));
  return `${new Date().toISOString()} [${traceId}] [${stageId}] [${event}] [${attempt}] ${safePayload}`;
}

export function appendDebugLogLine(taskDir: string, line: string): void {
  const debugPath = path.join(taskDir, '.wf-debug.log');
  fs.appendFileSync(debugPath, `${line}\n`, 'utf-8');
}
