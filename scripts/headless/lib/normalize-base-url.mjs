/**
 * Normalize OpenAI-compatible API base URL.
 * Accepts official forms:
 *   https://api.deepseek.com
 *   https://api.deepseek.com/v1
 * Engine appends `/chat/completions` (not `/v1/chat/completions`).
 */
export function normalizeLlmBaseUrl(raw) {
  const trimmed = (raw ?? 'https://api.deepseek.com/v1').trim().replace(/\/+$/, '')
  if (trimmed.endsWith('/v1')) {
    return trimmed
  }
  return `${trimmed}/v1`
}
