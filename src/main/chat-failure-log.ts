import log from 'electron-log'

/* ------------------------------------------------------------------ */
/*  Last chat failure snapshot for diagnostics UI                     */
/* ------------------------------------------------------------------ */

export type ChatFailureKind =
  | 'timeout'
  | 'certificate-proxy'
  | 'proxy-mismatch'
  | 'navigation-interrupt'
  | 'playwright-cdp'
  | 'inject'
  | 'unknown'

export type ChatFailureStage = 'send' | 'inject' | 'network' | 'dom' | 'settle' | 'repair'

export interface ChatFailureRecord {
  sendSeq?: string
  siteId: string
  hostname: string
  kind: ChatFailureKind
  code?: string
  stage?: ChatFailureStage
  detail: string
  retryable?: boolean
  automationPath: 'playwright' | 'legacy'
  ts: number
}

let last: ChatFailureRecord | null = null
const recent: ChatFailureRecord[] = []

export function recordChatFailure(rec: Omit<ChatFailureRecord, 'ts'>): void {
  const full = { ...rec, ts: Date.now() }
  last = full
  recent.push(full)
  while (recent.length > 50) recent.shift()
  log.warn('automation: failure-event', {
    errorCode: full.code ?? 'UNKNOWN',
    stage: full.stage ?? 'send',
    sendSeq: full.sendSeq ?? '',
    path: full.automationPath,
    siteId: full.siteId,
    retryable: full.retryable ?? false,
    detail: full.detail,
  })
}

export function getLastChatFailure(): ChatFailureRecord | null {
  return last
}

export function clearChatFailure(): void {
  last = null
  recent.splice(0, recent.length)
}

export function listRecentChatFailures(limit = 20): ChatFailureRecord[] {
  if (limit <= 0) return []
  return recent.slice(-limit)
}
