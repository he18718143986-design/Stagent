import type { AutomationResult } from '../site-store'

interface AdapterSettledPayload {
  sendSeq: string
  siteId: string
  result?: AutomationResult
  error?: string
}

const waiters = new Map<string, (payload: AdapterSettledPayload) => void>()
const settledCache = new Map<string, AdapterSettledPayload>()

export function notifyAdapterSettled(payload: AdapterSettledPayload): void {
  settledCache.set(payload.sendSeq, payload)
  const waiter = waiters.get(payload.sendSeq)
  if (waiter) {
    waiters.delete(payload.sendSeq)
    waiter(payload)
  }
  while (settledCache.size > 200) {
    const first = settledCache.keys().next().value
    if (!first) break
    settledCache.delete(first)
  }
}

export function waitAdapterSettled(sendSeq: string, timeoutMs = 130_000): Promise<AdapterSettledPayload> {
  const cached = settledCache.get(sendSeq)
  if (cached) return Promise.resolve(cached)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(sendSeq)
      reject(new Error(`adapter-wait-timeout:${sendSeq}`))
    }, timeoutMs)
    waiters.set(sendSeq, (payload) => {
      clearTimeout(timer)
      resolve(payload)
    })
  })
}

