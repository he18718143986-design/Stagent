/* ------------------------------------------------------------------ */
/*  CDP Network tap — same WebContents as inject (fixes fetch misses)   */
/* ------------------------------------------------------------------ */

import type { WebContents } from 'electron'
import log from 'electron-log'
import { accumulateSseText } from './sse-parse'
import { networkInterceptorAccepted } from './chat-reply-race'
import type { WatchResult } from './response-watcher'

export interface SseDebuggerTap {
  promise: Promise<WatchResult | null>
  dispose: () => void
}

/**
 * Observes Network responses for this WebContents only via debugger protocol.
 * Complements the in-page fetch wrapper when ChatGPT uses paths/workers the wrapper misses.
 */
export function startSseDebuggerTap(
  wc: WebContents,
  label: string,
  ssePattern: string,
  sseDataExtractor: string | undefined,
  deadlineMs: number,
): SseDebuggerTap {
  let regex: RegExp
  try {
    regex = new RegExp(ssePattern)
  } catch {
    return {
      promise: Promise.resolve(null),
      dispose: () => {},
    }
  }

  const dbg = wc.debugger

  const ensureAttached = (): boolean => {
    try {
      if (!dbg.isAttached()) dbg.attach('1.3')
      return true
    } catch (e) {
      log.warn('network-sse-cdp: debugger attach failed', { label, err: String(e) })
      return false
    }
  }

  if (!ensureAttached()) {
    return { promise: Promise.resolve(null), dispose: () => {} }
  }

  let timer: NodeJS.Timeout | null = null
  let done = false
  let detachMessage: (() => void) | null = null

  let finish!: (v: WatchResult | null) => void

  const promise = new Promise<WatchResult | null>((resolve) => {
    let matchedRequestCount = 0
    finish = (v: WatchResult | null): void => {
      if (done) return
      done = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      detachMessage?.()
      detachMessage = null
      dbg.sendCommand('Network.disable').catch(() => {})
      if (v === null && matchedRequestCount === 0) {
        log.warn('network-sse-cdp: no matching network response before deadline', { label })
      }
      resolve(v)
    }

    const sseRequestIds = new Set<string>()
    const ridMeta = new Map<string, { url: string; mimeType?: string }>()

    function onMessage(_evt: Electron.Event, method: string, params: Record<string, unknown>): void {
      if (method === 'Network.responseReceived') {
        const resp = params.response as { url?: string; mimeType?: string } | undefined
        const url = resp?.url ?? ''
        const rid = params.requestId as string | undefined
        if (!url || !rid || !regex.test(url)) return
        matchedRequestCount += 1
        sseRequestIds.add(rid)
        ridMeta.set(rid, { url: url.slice(0, 160), mimeType: resp?.mimeType })
      }
      if (method === 'Network.loadingFinished') {
        const rid = params.requestId as string | undefined
        if (!rid || !sseRequestIds.has(rid)) return
        sseRequestIds.delete(rid)
        const meta = ridMeta.get(rid)
        ridMeta.delete(rid)
        void dbg
          .sendCommand('Network.getResponseBody', { requestId: rid })
          .then((body: { body: string; base64Encoded: boolean }) => {
            const raw = body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body
            const text = accumulateSseText(raw, sseDataExtractor)
            const candidate: WatchResult = { text, timedOut: false }
            if (networkInterceptorAccepted(candidate)) {
              log.info('network-sse-cdp: SSE body accepted via Debugger', {
                label,
                bytes: raw.length,
              })
              finish(candidate)
              return
            }
            if (raw.length > 120) {
              log.warn('network-sse-cdp: matched streaming URL but parsed no assistant text', {
                label,
                mimeType: meta?.mimeType ?? '',
                urlPreview: meta?.url ?? '',
                byteLen: raw.length,
                bodyPreview: raw.slice(0, 160).replace(/\s+/g, ' '),
              })
            }
          })
          .catch((err) => {
            log.warn('network-sse-cdp: getResponseBody failed', { label, err: String(err) })
          })
      }
    }

    detachMessage = (): void => {
      void dbg.removeListener('message', onMessage)
    }
    dbg.on('message', onMessage)

    dbg
      .sendCommand('Network.enable', {
        maxResourceBufferSize: 150 * 1024 * 1024,
        maxTotalBufferSize: 200 * 1024 * 1024,
      })
      .catch((err) => {
        log.warn('network-sse-cdp: Network.enable failed', { label, err: String(err) })
        finish(null)
      })

    timer = setTimeout(() => finish(null), deadlineMs)
  })

  const dispose = (): void => {
    finish(null)
  }

  return { promise, dispose }
}
