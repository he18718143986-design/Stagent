/* ------------------------------------------------------------------ */
/*  Playwright CDP network observation (SSE response.body)             */
/* ------------------------------------------------------------------ */

import log from 'electron-log'
import type { Browser, Page } from 'playwright'
import { accumulateSseText } from '../sse-parse'
import { networkInterceptorAccepted } from '../chat-reply-race'
import type { WatchResult } from '../response-watcher'

const PW_SSE_WAIT_MS = 125_000
export type PickedPlaywrightPages = Page | Page[]

function hostnameMatchesPage(pageUrl: string, hostname: string): boolean {
  try {
    const h = new URL(pageUrl).hostname.toLowerCase()
    const want = hostname.toLowerCase()
    return h === want || h.endsWith('.' + want)
  } catch {
    return false
  }
}

/** Strip hash; normalize trailing slash for stable compares */
export function normalizeUrlForMatch(raw: string): string {
  try {
    const x = new URL(raw)
    x.hash = ''
    if (x.pathname.length > 1 && x.pathname.endsWith('/')) {
      x.pathname = x.pathname.slice(0, -1)
    }
    return x.href
  } catch {
    return raw
  }
}

/**
 * Bind Playwright to the same document as `managed` WebContents — critical when
 * several accounts share one hostname (multiple ChatGPT tabs).
 */
export function pickPageForWebContents(
  browser: import('playwright').Browser,
  hostname: string,
  webContentsUrl: string,
  siteId: string,
): PickedPlaywrightPages | null {
  const pages = browser.contexts().flatMap((c) => c.pages())
  if (pages.length === 0) return null

  const normWc = normalizeUrlForMatch(webContentsUrl)
  const exactMatches = pages.filter((p) => {
    try {
      return normalizeUrlForMatch(p.url()) === normWc
    } catch {
      return false
    }
  })
  if (exactMatches.length === 1) {
    log.info('automation: Playwright page matched WebContents URL', { siteId, url: normWc.slice(0, 120) })
    return exactMatches[0]!
  }
  if (exactMatches.length > 1) {
    log.warn(
      'automation: multiple CDP pages share normalized URL — using multi-page Playwright SSE interceptor',
      { siteId, count: exactMatches.length },
    )
    return exactMatches
  }

  const hostMatches = pages.filter((p) => {
    try {
      return hostnameMatchesPage(p.url(), hostname)
    } catch {
      return false
    }
  })
  if (hostMatches.length === 1) {
    log.info('automation: Playwright page matched hostname (unique)', { siteId, hostname })
    return hostMatches[0]!
  }
  if (hostMatches.length === 0) {
    log.warn('automation: no Playwright page for hostname', { siteId, hostname })
    return null
  }

  log.warn(
    'automation: ambiguous Playwright pages for hostname — using multi-page Playwright SSE interceptor',
    { siteId, hostname, candidateCount: hostMatches.length },
  )
  return hostMatches
}

export async function connectPlaywrightToElectron(port: string): Promise<Browser | null> {
  try {
    const { chromium } = await import('playwright')
    return await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  } catch (err) {
    log.warn('automation: Playwright connectOverCDP failed — fallback legacy interceptor', {
      port,
      err: String(err),
    })
    return null
  }
}

/**
 * Listens for the first finished SSE response matching regex pattern; parses body like legacy interceptor.
 */
export function startPlaywrightSseInterceptor(
  picked: PickedPlaywrightPages,
  siteId: string,
  ssePattern: string | undefined,
  sseExtractor: string | undefined,
): Promise<WatchResult | null> {
  if (!ssePattern?.trim()) {
    return Promise.resolve(null)
  }

  let regex: RegExp
  try {
    regex = new RegExp(ssePattern)
  } catch {
    log.warn('automation: invalid ssePattern for Playwright path', { siteId, ssePattern })
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    const pages = Array.isArray(picked) ? picked : [picked]
    if (pages.length > 1) {
      log.info('automation: Playwright SSE interceptor attached to multiple candidate pages', {
        siteId,
        count: pages.length,
      })
    }
    let settled = false
    const finish = (v: WatchResult | null): void => {
      if (settled) return
      settled = true
      for (const p of pages) p.off('response', onResponse)
      clearTimeout(timer)
      resolve(v)
    }

    const timer = setTimeout(() => finish(null), PW_SSE_WAIT_MS)

    const onResponse = async (response: import('playwright').Response): Promise<void> => {
      if (settled) return
      try {
        const url = response.url()
        if (!regex.test(url)) return

        const body = await response.text()
        const text = accumulateSseText(body, sseExtractor)
        const candidate: WatchResult = { text, timedOut: false }
        if (networkInterceptorAccepted(candidate)) {
          log.info('automation: Playwright SSE interceptor accepted', { siteId, urlPreview: url.slice(0, 120) })
          finish(candidate)
        }
      } catch {
        /* ignore stray responses */
      }
    }

    for (const p of pages) p.on('response', onResponse)
  })
}
