/* ------------------------------------------------------------------ */
/*  Shared inject + settle-once reply race + chat:reply dispatch      */
/* ------------------------------------------------------------------ */

import type { BrowserWindow } from 'electron'
import log from 'electron-log'
import type { ManagedView } from '../browser-view'
import type { SiteStore } from '../site-store'
import type { SiteConfig, AutomationResult } from '../site-store'
import { inject } from '../injector'
import { watchForReply, isLikelyAuthorLabel } from '../response-watcher'
import type { WatchResult } from '../response-watcher'
import { raceReply, getTimeoutFailureHint, networkInterceptorAccepted } from '../chat-reply-race'
import { recordChatFailure } from '../chat-failure-log'
import { clearChatBusy } from '../chat-busy'
import { classifyFailure } from './failure-classifier'
import { runLimitedAutoRepair } from './repair-orchestrator'
import { recordRecoveredByAutoRepair, recordSendSettled } from './metrics'
import { notifyAdapterSettled } from './adapter-events'
import { delay } from './utils'

export interface ReplyPipelineParams {
  win: BrowserWindow
  store: SiteStore
  validSiteId: string
  validText: string
  fresh: SiteConfig
  managed: ManagedView
  sendSeq: string
  interceptorPromise: Promise<WatchResult | null>
  interceptorFactory?: () => Promise<WatchResult | null>
  automationPath: 'playwright' | 'legacy'
  disposeInterceptor?: () => Promise<void>
  removeNavGuard: () => void
}

export async function runChatReplyPipeline(p: ReplyPipelineParams): Promise<{ ok: true } | { error: string }> {
  const { win, store, validSiteId, validText, fresh, managed, interceptorPromise, automationPath, sendSeq } = p

  let disposeRan = false
  const runDispose = async (): Promise<void> => {
    if (disposeRan) return
    disposeRan = true
    await p.disposeInterceptor?.().catch(() => {})
  }

  try {
    const result = await inject(managed.view, validText, fresh.inputSelectors, fresh.sendSelectors)

    if (!result.ok) {
      const retryDelays = [2500, 5000]
      let lastRetry = result
      for (const ms of retryDelays) {
        log.info('automation: inject failed, retrying after delay', {
          siteId: validSiteId,
          delay: ms,
          reason: lastRetry.reason,
        })
        await delay(ms)
        lastRetry = await inject(managed.view, validText, fresh.inputSelectors, fresh.sendSelectors)
        if (lastRetry.ok) break
      }
      if (!lastRetry.ok) {
        clearChatBusy()
        p.removeNavGuard()
        await runDispose()
        log.warn('automation: inject failed', { sendSeq, siteId: validSiteId, reason: lastRetry.reason })
        win.webContents.send('calibrate:needed', { siteId: validSiteId })
        recordChatFailure({
          sendSeq,
          siteId: validSiteId,
          hostname: fresh.hostname,
          kind: 'inject',
          code: 'INJECT_FAILED',
          stage: 'inject',
          detail: lastRetry.reason ?? 'inject failed',
          retryable: true,
          automationPath,
        })
        notifyAdapterSettled({ sendSeq, siteId: validSiteId, error: lastRetry.reason ?? 'inject failed' })
        return { error: lastRetry.reason ?? 'inject failed' }
      }
      Object.assign(result, lastRetry)
    }

    log.info('automation: inject succeeded', {
      siteId: validSiteId,
      input: result.usedInputSelector,
      send: result.usedSendSelector,
    })

    store.recordSelectorSuccess(validSiteId, result.usedInputSelector, result.usedSendSelector)

    if (!win.isDestroyed()) win.webContents.focus()

    const domPromise = watchForReply(
      managed.view,
      fresh.responseSelectors,
      fresh.outputType,
      fresh.quotaExhaustedIndicator,
    )

    interceptorPromise
      .then((nr) => {
        if (nr === null) {
          log.info('automation: reply path: no network interceptor -> dom', { sendSeq, siteId: validSiteId })
        } else if (!networkInterceptorAccepted(nr)) {
          const reason =
            nr.timedOut
              ? 'timed-out'
              : isLikelyAuthorLabel(nr.text ?? '')
                ? 'author-label-only'
                : (nr.text ?? '').trim().length === 0
                  ? 'empty-text'
                  : 'unaccepted-shape'
          log.warn('automation: reply path: network invalid -> dom running', {
            sendSeq,
            siteId: validSiteId,
            timedOut: nr.timedOut,
            reason,
            textLen: (nr.text ?? '').length,
            interceptReason: nr._interceptReason,
          })
        }
      })
      .catch(() => {})

    raceReply(interceptorPromise, domPromise, (src) => {
        log.info(`automation: reply ignored: late ${src}`, { sendSeq, siteId: validSiteId })
    })
      .then(async ({ source, result: watchResult }) => {
        const preClassified = classifyFailure({
          timedOut: watchResult.timedOut,
          watchResult,
        })
        log.info('automation: reply settled', {
          sendSeq,
          source,
          siteId: validSiteId,
          timedOut: watchResult.timedOut,
          path: automationPath,
          diagnosis: preClassified.code,
          diagnosisConfidence: preClassified.confidence,
        })
        if (watchResult.quotaExhausted) {
          store.setQuotaExhausted(validSiteId, true)
          win.webContents.send('chat:quota-exhausted', validSiteId)
          win.webContents.send('site:status-changed', {
            siteId: validSiteId,
            status: 'quota-exhausted',
          })
          recordSendSettled(validSiteId, false)
          // M14(缺口1): wake any adapter waiter immediately with a quota signal so
          // the local adapter can return 429 (→ chain cooldown + failover) instead
          // of blocking on waitAdapterSettled until its 130s timeout.
          notifyAdapterSettled({
            sendSeq,
            siteId: validSiteId,
            result: { outputType: fresh.outputType, quotaExhausted: true },
          })
        } else {
          const safeText =
            typeof watchResult.text === 'string' && isLikelyAuthorLabel(watchResult.text)
              ? ''
              : watchResult.text
          if (watchResult.text && safeText === '') {
            log.warn('automation: filtered author-label-only reply text', { siteId: validSiteId })
          }
          const timeoutHint =
            (!safeText || safeText.trim().length === 0) && watchResult.timedOut
              ? await getTimeoutFailureHint(managed.view.webContents, fresh.hostname)
              : undefined
          const timeoutFallbackText =
            (!safeText || safeText.trim().length === 0) && watchResult.timedOut
              ? `[${fresh.hostname}] 响应流超时（120s）且未提取到正文。可能是网络/证书/风控导致流中断，请先在网页中确认是否有错误提示或验证页面。`
              : undefined
          const finalText = timeoutHint ?? timeoutFallbackText ?? safeText

          if ((!finalText || String(finalText).trim().length === 0) && watchResult.timedOut) {
            const classified = classifyFailure({
              timedOut: watchResult.timedOut,
              watchResult,
              timeoutHint,
              detail: timeoutHint ?? 'timed-out-empty-body',
            })
            const repair = await runLimitedAutoRepair({
              sendSeq,
              siteId: validSiteId,
              hostname: fresh.hostname,
              failureCode: classified.code,
              automationPath,
              retryable: classified.retryable,
              interceptorFactory: p.interceptorFactory,
            })
            if (repair.applied && repair.result && networkInterceptorAccepted(repair.result)) {
              recordRecoveredByAutoRepair()
              recordSendSettled(validSiteId, false)
              const recoveredResult: AutomationResult = {
                outputType: fresh.outputType,
                text: repair.result.text ?? '',
              }
              log.info('automation: auto-repair recovered reply', {
                sendSeq,
                siteId: validSiteId,
                action: repair.action,
                textLen: (repair.result.text ?? '').length,
              })
              win.webContents.send('chat:reply', { siteId: validSiteId, result: recoveredResult })
              notifyAdapterSettled({ sendSeq, siteId: validSiteId, result: recoveredResult })
              return
            }
            recordChatFailure({
              sendSeq,
              siteId: validSiteId,
              hostname: fresh.hostname,
              kind: classifyTimeoutFailure(timeoutHint),
              code: 'TIMEOUT_EMPTY_BODY',
              stage: 'settle',
              detail: timeoutHint ?? 'timed-out-empty-body',
              retryable: true,
              automationPath,
            })
          }

          const automationResult: AutomationResult = {
            outputType: fresh.outputType,
            ...(finalText !== undefined && { text: finalText }),
            ...(watchResult.imageUrls !== undefined && { imageUrls: watchResult.imageUrls }),
          }
          log.info('automation: sending chat:reply', {
            sendSeq,
            siteId: validSiteId,
            timedOut: watchResult.timedOut,
            textPreview: typeof finalText === 'string' ? finalText.slice(0, 80) : undefined,
            textLen: typeof finalText === 'string' ? finalText.length : undefined,
          })
          win.webContents.send('chat:reply', { siteId: validSiteId, result: automationResult })
          notifyAdapterSettled({ sendSeq, siteId: validSiteId, result: automationResult })
          recordSendSettled(validSiteId, !!watchResult.timedOut)
        }
      })
      .catch((err) => {
        log.error('automation: raceReply error', { sendSeq, siteId: validSiteId, err: String(err) })
        recordChatFailure({
          sendSeq,
          siteId: validSiteId,
          hostname: fresh.hostname,
          kind: 'unknown',
          code: 'RACE_REPLY_ERROR',
          stage: 'settle',
          detail: String(err),
          retryable: false,
          automationPath,
        })
        win.webContents.send('chat:reply', {
          siteId: validSiteId,
          result: { outputType: fresh.outputType, text: '' } satisfies AutomationResult,
        })
        notifyAdapterSettled({ sendSeq, siteId: validSiteId, error: String(err) })
        recordSendSettled(validSiteId, true)
      })
      .finally(() => {
        p.removeNavGuard()
        clearChatBusy()
        void runDispose()
      })

    return { ok: true }
  } catch (err) {
    p.removeNavGuard()
    clearChatBusy()
    await runDispose()
    log.error('automation: reply pipeline exception', { siteId: validSiteId, err: String(err) })
    notifyAdapterSettled({ sendSeq, siteId: validSiteId, error: String(err) })
    return { error: String(err) }
  }
}

function classifyTimeoutFailure(
  hint: string | undefined,
): 'timeout' | 'certificate-proxy' | 'proxy-mismatch' | 'unknown' {
  if (!hint) return 'timeout'
  const h = hint.toLowerCase()
  if (h.includes('证书') || h.includes('ssl') || h.includes('handshake')) return 'certificate-proxy'
  if (h.includes('代理') || h.includes('proxy')) return 'proxy-mismatch'
  return 'timeout'
}
