export function getRecentDebugLogLines(raw: string, limit = 200): string {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  return lines.slice(-limit).join('\n');
}

export type DebugLogCopyResult =
  | { ok: true; content: string }
  | { ok: false; reason: 'not-found' | 'empty' };

/**
 * @param tailLineLimit 仅复制末尾若干行（剔除纯空行后计数）。不传则复制 **完整** `.wf-debug.log` 原文。
 */
export function buildDebugLogCopyResult(raw: string | undefined, tailLineLimit?: number): DebugLogCopyResult {
  if (raw === undefined) {
    return { ok: false, reason: 'not-found' };
  }
  const content =
    tailLineLimit === undefined ? raw : getRecentDebugLogLines(raw, tailLineLimit);
  if (!content.trim()) {
    return { ok: false, reason: 'empty' };
  }
  return { ok: true, content };
}
