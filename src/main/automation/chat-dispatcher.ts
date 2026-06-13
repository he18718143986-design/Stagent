/* ------------------------------------------------------------------ */
/*  chat:send — detector + automation mode + shared reply pipeline     */
/* ------------------------------------------------------------------ */

import type { BrowserWindow, Event as ElectronEvent, WebContentsDidStartNavigationEventParams } from 'electron'
import log from 'electron-log'
import type { BrowserViewManager, ManagedView } from '../browser-view'
import type { WatchResult } from '../response-watcher'
import type { SiteStore } from '../site-store'
import { detectAndSave } from '../detector'
import { findPreset } from '../presets'
import { clearChatBusy } from '../chat-busy'
import { recordChatFailure } from '../chat-failure-log'
import { buildSendSeq } from './failure-codes'
import { recordSendStarted } from './metrics'
import { resolveAutomationMode, resolveCdpPort } from './mode'
import { startLegacyNetworkInterceptor } from './legacy-interceptor'
import { connectPlaywrightToElectron, pickPageForWebContents, startPlaywrightSseInterceptor } from './playwright-network'
import { runChatReplyPipeline } from './reply-pipeline'

export interface ChatDispatchInput {
  win: BrowserWindow
  store: SiteStore
  bvm: BrowserViewManager
  validSiteId: string
  validText: string
  managed: ManagedView
}

export async function dispatchChatSend(input: ChatDispatchInput): Promise<{ ok: true; sendSeq: string } | { error: string }> {
  const { win, store, bvm, validSiteId, validText, managed } = input
  const wc = managed.view.webContents
  wc.focus()

  const config = store.get(validSiteId)!
  const needsDetection =
    config.inputSelectors.length === 0 ||
    config.sendSelectors.length === 0 ||
    config.responseSelectors.length === 0

  if (needsDetection) {
    log.info('automation: running detector', { siteId: validSiteId })
    const found = await detectAndSave(validSiteId, managed.view, store)
    if (!found) {
      clearChatBusy()
      win.webContents.send('calibrate:needed', { siteId: validSiteId })
      return { error: 'selectors-not-found' }
    }
  }

  const fresh = store.get(validSiteId)!
  const ssePreset = findPreset(fresh.hostname)
  const ssePattern = fresh.ssePattern ?? ssePreset?.ssePattern
  const sseExtractor = fresh.sseDataExtractor ?? ssePreset?.sseDataExtractor

  const modeEarly = resolveAutomationMode(fresh.hostname)
  const sendSeq = buildSendSeq(validSiteId)
  recordSendStarted(validSiteId)

  const onNav = (): void => {
    bvm.reportChatInterrupted(validSiteId, 'navigation-during-chat')
    recordChatFailure({
      sendSeq,
      siteId: validSiteId,
      hostname: fresh.hostname,
      kind: 'navigation-interrupt',
      code: 'NAVIGATION_INTERRUPTED',
      stage: 'send',
      detail: 'cross-document-main-frame-navigation',
      retryable: false,
      automationPath: modeEarly === 'playwright' ? 'playwright' : 'legacy',
    })
  }
  /** Ignore SPA pushState / hash — those fire did-start-navigation but are not a hard reload */
  const onMaybeHardNavigation = (
    details: ElectronEvent<WebContentsDidStartNavigationEventParams>,
  ): void => {
    if (details.isSameDocument) return
    if (!details.isMainFrame) return
    onNav()
  }
  wc.on('did-start-navigation', onMaybeHardNavigation)
  const removeNav = (): void => {
    wc.removeListener('did-start-navigation', onMaybeHardNavigation)
  }

  const mode = modeEarly
  const cdpPort = resolveCdpPort()

  let interceptorPromise: ReturnType<typeof startLegacyNetworkInterceptor>
  let interceptorFactory: (() => Promise<WatchResult | null>) | undefined
  let automationPath: 'playwright' | 'legacy' = 'legacy'
  let disposeInterceptor: (() => Promise<void>) | undefined

  try {
    if (mode === 'playwright') {
      const browser = await connectPlaywrightToElectron(cdpPort)
      if (browser) {
        const picked = pickPageForWebContents(browser, fresh.hostname, wc.getURL(), validSiteId)
        if (picked) {
          interceptorFactory = () => startPlaywrightSseInterceptor(picked, validSiteId, ssePattern, sseExtractor)
          interceptorPromise = interceptorFactory()
          automationPath = 'playwright'
          disposeInterceptor = async () => {
            await browser.close().catch(() => {})
          }
        } else {
          await browser.close().catch(() => {})
          log.warn(
            'automation: Playwright SSE path unavailable (no bound CDP page — often duplicate hostname tabs) — legacy interceptor',
            {
              siteId: validSiteId,
              hostname: fresh.hostname,
            },
          )
          recordChatFailure({
            sendSeq,
            siteId: validSiteId,
            hostname: fresh.hostname,
            kind: 'playwright-cdp',
            code: 'PW_NO_BOUND_PAGE',
            stage: 'network',
            detail: 'no-bound-cdp-page',
            retryable: true,
            automationPath: 'legacy',
          })
          interceptorFactory = () => startLegacyNetworkInterceptor(managed.view, validSiteId, ssePattern, sseExtractor, sendSeq)
          interceptorPromise = interceptorFactory()
        }
      } else {
        recordChatFailure({
          sendSeq,
          siteId: validSiteId,
          hostname: fresh.hostname,
          kind: 'playwright-cdp',
          code: 'PW_CDP_CONNECT_FAILED',
          stage: 'network',
          detail: 'connectOverCDP-failed',
          retryable: true,
          automationPath: 'legacy',
        })
        interceptorFactory = () => startLegacyNetworkInterceptor(managed.view, validSiteId, ssePattern, sseExtractor, sendSeq)
        interceptorPromise = interceptorFactory()
      }
    } else {
      interceptorFactory = () => startLegacyNetworkInterceptor(managed.view, validSiteId, ssePattern, sseExtractor, sendSeq)
      interceptorPromise = interceptorFactory()
    }

    const run = await runChatReplyPipeline({
      win,
      store,
      validSiteId,
      validText,
      fresh,
      managed,
      sendSeq,
      interceptorPromise,
      interceptorFactory,
      automationPath,
      disposeInterceptor,
      removeNavGuard: removeNav,
    })
    if ('ok' in run) return { ok: true, sendSeq }
    return run
  } catch (err) {
    removeNav()
    clearChatBusy()
    log.error('automation: dispatchChatSend exception', { siteId: validSiteId, err: String(err) })
    return { error: String(err) }
  }
}
