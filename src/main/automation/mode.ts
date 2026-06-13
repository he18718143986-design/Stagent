/* ------------------------------------------------------------------ */
/*  AUTOAI_AUTOMATION_MODE + optional AUTOAI_PLAYWRIGHT_HOSTS graylist */
/* ------------------------------------------------------------------ */

export type AutomationMode = 'legacy' | 'playwright'

/** CDP port for Electron remote-debugging-port (Playwright connectOverCDP). */
export function resolveCdpPort(): string {
  return (process.env.AUTOAI_CDP_PORT || '9223').trim()
}

/**
 * Default `legacy` for safe rollout.
 * Set `AUTOAI_AUTOMATION_MODE=playwright` globally, or restrict with
 * `AUTOAI_PLAYWRIGHT_HOSTS=chatgpt.com,claude.ai` (comma-separated substrings).
 */
export function resolveAutomationMode(hostname: string): AutomationMode {
  const hosts = (process.env.AUTOAI_PLAYWRIGHT_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

  if (hosts.length > 0) {
    const h = hostname.toLowerCase()
    const hit = hosts.some((needle) => h.includes(needle))
    return hit ? 'playwright' : 'legacy'
  }

  const raw = (process.env.AUTOAI_AUTOMATION_MODE || 'legacy').trim().toLowerCase()
  return raw === 'playwright' ? 'playwright' : 'legacy'
}
