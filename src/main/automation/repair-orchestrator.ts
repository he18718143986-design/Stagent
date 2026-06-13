import log from 'electron-log'
import type { WatchResult } from '../response-watcher'
import type { FailureCode } from './failure-codes'

export interface RepairInput {
  sendSeq: string
  siteId: string
  hostname: string
  failureCode: FailureCode
  automationPath: 'playwright' | 'legacy'
  retryable: boolean
  interceptorFactory?: () => Promise<WatchResult | null>
}

export interface RepairResult {
  applied: boolean
  action: 'reArmInterceptor' | 'forceLegacyDomFallback' | 'none'
  result?: WatchResult | null
  skippedReason?: string
}

const recentByCode = new Map<string, { count: number; nextAllowedAt: number }>()

function isAutoRepairEnabled(hostname: string): boolean {
  const on = (process.env.AUTOAI_ENABLE_AUTOREPAIR || '').trim()
  if (!on) return false
  const hosts = (process.env.AUTOAI_AUTOREPAIR_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  if (!hosts.length) return true
  const lower = hostname.toLowerCase()
  return hosts.some((h) => lower.includes(h))
}

export async function runLimitedAutoRepair(input: RepairInput): Promise<RepairResult> {
  if (!isAutoRepairEnabled(input.hostname)) {
    return { applied: false, action: 'none', skippedReason: 'disabled-by-env' }
  }
  const now = Date.now()
  const gateKey = `${input.siteId}:${input.failureCode}`
  const gate = recentByCode.get(gateKey)
  if (gate && now < gate.nextAllowedAt) {
    return { applied: false, action: 'none', skippedReason: 'backoff-window' }
  }
  const nextCount = (gate?.count ?? 0) + 1
  const backoffMs = Math.min(30_000, 1000 * (2 ** Math.min(nextCount, 5)))
  recentByCode.set(gateKey, { count: nextCount, nextAllowedAt: now + backoffMs })

  if (!input.retryable) {
    return { applied: false, action: 'none', skippedReason: 'not-retryable' }
  }

  // Conservative guard: at most one automatic recovery chain per send.
  if (!input.interceptorFactory) {
    return { applied: false, action: 'none', skippedReason: 'no-interceptor-factory' }
  }

  if (input.failureCode === 'TIMEOUT_EMPTY_BODY'
    || input.failureCode === 'SSE_EMPTY_BODY'
    || input.failureCode === 'CDP_NO_RESPONSE_BODY'
    || input.failureCode === 'DOM_AUTHOR_LABEL_ONLY') {
    try {
      const start = Date.now()
      const result = await Promise.race([
        input.interceptorFactory(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 9000)),
      ])
      log.info('automation: auto-repair attempted', {
        sendSeq: input.sendSeq,
        siteId: input.siteId,
        action: 'reArmInterceptor',
        elapsedMs: Date.now() - start,
        recovered: !!(result && (result.text?.trim().length || result.imageUrls?.length)),
      })
      return { applied: true, action: 'reArmInterceptor', result }
    } catch (err) {
      log.warn('automation: auto-repair failed', {
        sendSeq: input.sendSeq,
        siteId: input.siteId,
        err: String(err),
      })
      return { applied: false, action: 'none', skippedReason: 'repair-error' }
    }
  }

  return { applied: false, action: 'none', skippedReason: 'no-policy' }
}

