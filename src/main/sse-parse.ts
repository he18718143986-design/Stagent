/* ------------------------------------------------------------------ */
/*  SSE body parsing — shared by fetch-wrapper + Playwright response    */
/* ------------------------------------------------------------------ */

/**
 * Parses accumulated SSE text lines into assistant-visible text chunks.
 * Mirrors network-interceptor bootstrap `_extract` semantics.
 */
export function extractFromSseDataLine(linePayload: string, extractorBody?: string): string | null {
  if (linePayload === '[DONE]') return null
  if (extractorBody) {
    try {
      const fn = new Function('line', extractorBody) as (line: string) => unknown
      const r = fn(linePayload)
      return typeof r === 'string' ? r : null
    } catch {
      /* fall through */
    }
  }
  try {
    const d = JSON.parse(linePayload) as Record<string, unknown>
    if (!d) return null
    if (typeof d.v === 'string') return d.v
    if (
      d.type === 'content_block_delta' &&
      d.delta &&
      typeof (d.delta as { text?: unknown }).text === 'string'
    ) {
      return (d.delta as { text: string }).text
    }
  } catch {
    /* ignore */
  }
  return null
}

/** Consumes a full SSE-ish HTTP body string (may contain multiple data: lines). */
export function accumulateSseText(rawBody: string, extractorBody?: string): string {
  let accumulated = ''
  const lines = rawBody.split(/\r?\n/)
  for (const line of lines) {
    const ln = line.trim()
    if (!ln.startsWith('data: ')) continue
    const payload = ln.slice(6)
    const chunk = extractFromSseDataLine(payload, extractorBody)
    if (chunk !== null) accumulated += chunk
  }
  return accumulated
}
