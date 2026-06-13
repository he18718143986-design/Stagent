/* ------------------------------------------------------------------ */
/*  Legacy fetch-wrapper interceptor orchestration (bootstrap + arm)   */
/* ------------------------------------------------------------------ */

import type { WebContentsView } from 'electron'
import log from 'electron-log'
import { interceptReply } from '../network-interceptor'
import type { WatchResult } from '../response-watcher'
import { networkInterceptorAccepted } from '../chat-reply-race'
import { delay } from './utils'

export function startLegacyNetworkInterceptor(
  view: WebContentsView,
  siteId: string,
  ssePattern: string | undefined,
  sseExtractor: string | undefined,
  sendSeq?: string,
): Promise<WatchResult | null> {
  return (async (): Promise<WatchResult | null> => {
    const logLabel = sendSeq ? `${siteId}#${sendSeq}` : siteId
    const first = await interceptReply(view, ssePattern, sseExtractor, logLabel)
    if (first !== null && networkInterceptorAccepted(first)) return first

    const shouldRetry =
      first == null
      || first._interceptReason === 'bootstrap-missing'
      || (!!first.timedOut)
      || ((first.text ?? '').trim().length === 0 && first._interceptReason !== 'main-timeout')

    if (!shouldRetry) {
      return first
    }

    await delay(1200)
    const second = await Promise.race<WatchResult | null>([
      interceptReply(view, ssePattern, sseExtractor, logLabel),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ])
    if (second !== null && networkInterceptorAccepted(second)) {
      log.info('automation: network interceptor second-arm succeeded', { siteId })
      return second
    }
    if (second === null) {
      log.warn('automation: network interceptor second-arm short-window timeout', { siteId })
    }
    return second ?? first
  })()
}
