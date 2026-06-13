/* ------------------------------------------------------------------ */
/*  src/main/browser-view.ts — WebContentsView lifecycle management   */
/*  M10: keyed by siteId (UUID) instead of hostname                   */
/* ------------------------------------------------------------------ */

import { WebContentsView, BrowserWindow } from 'electron'
import log from 'electron-log'
import { getSession } from './session'
import { GENERIC_INPUT_SELECTOR } from './selector-utils'
import { buildBootstrapScript } from './network-interceptor'

/**
 * One WebContentsView per site record (siteId).
 *
 * Background architecture (fixes the old 0×0 approach):
 * - While chatting: views are CHILDREN of win.contentView (the React renderer).
 *   Children render on top, but the views are positioned off-screen
 *   (x = –(winW + 100)) so the user does not see them.
 *   The rendering SURFACE is full-window-size so requestAnimationFrame,
 *   MutationObserver and layout-dependent APIs work normally.
 * - While logging in / calibrating / browsing: the view is moved on-screen
 *   (x = 0, y = TITLEBAR_H). As a child of the renderer contentView it
 *   naturally renders on top of the React UI.
 */
export interface ManagedView {
  siteId: string
  view: WebContentsView
  /** true while the login window is being shown to the user */
  loginVisible: boolean
  /** true while the website is shown in browse mode (tab click) */
  browseVisible: boolean
  /** true once the user has successfully logged in (or startup probe confirms) */
  loginActive: boolean
  /** polling interval ID for login detection */
  loginPollInterval: NodeJS.Timeout | null
  /** cleanup fn that removes did-navigate listeners added by startLoginPoll */
  loginPollNavCleanup: (() => void) | null
}

export type RuntimeIssueCategory =
  | 'render-crash'
  | 'webcontents-destroyed'
  | 'network-fail'
  | 'chat-interrupted'
export type RuntimeRecoveryAction = 'auto-recreate' | 'manual-check'

export interface SiteRuntimeEvent {
  siteId: string
  category: RuntimeIssueCategory
  reason: string
  recovery: RuntimeRecoveryAction
  failureCount: number
  ts: number
}

export interface RuntimeRecoveryPolicy {
  windowMs: number
  autoRecoverThreshold: number
}

export interface RuntimeCategoryStats {
  count: number
  lastReason?: string
  lastAt?: number
}

export interface SiteRuntimeStats {
  siteId: string
  total: number
  recentInWindow: number
  byCategory: Record<RuntimeIssueCategory, RuntimeCategoryStats>
}

export interface RuntimeStatsSnapshot {
  policy: RuntimeRecoveryPolicy
  totals: Record<RuntimeIssueCategory, number>
  bySite: Record<string, SiteRuntimeStats>
}

interface RuntimeIssueState {
  count: number
  lastAt: number
}

export class BrowserViewManager {
  private readonly win: BrowserWindow
  private readonly views: Map<string, ManagedView> = new Map()
  private readonly onLoginActiveChange?: (siteId: string, active: boolean) => void
  private readonly onRuntimeEvent?: (event: SiteRuntimeEvent) => void
  private readonly issueState: Map<string, RuntimeIssueState> = new Map()
  private policy: RuntimeRecoveryPolicy = {
    windowMs: 5 * 60_000,
    autoRecoverThreshold: 2,
  }
  private readonly statsBySite: Map<string, SiteRuntimeStats> = new Map()
  private readonly totals: Record<RuntimeIssueCategory, number> = {
    'render-crash': 0,
    'webcontents-destroyed': 0,
    'network-fail': 0,
    'chat-interrupted': 0,
  }

  constructor(
    win: BrowserWindow,
    onLoginActiveChange?: (siteId: string, active: boolean) => void,
    onRuntimeEvent?: (event: SiteRuntimeEvent) => void,
  ) {
    this.win = win
    this.onLoginActiveChange = onLoginActiveChange
    this.onRuntimeEvent = onRuntimeEvent
  }

  /**
   * Returns bounds that position a view off-screen to the LEFT with full
   * window dimensions.  The rendering surface is w×h so Chromium schedules
   * requestAnimationFrame at the full display rate.  The view is invisible
   * because it is outside the window's clip area.
   */
  private offScreenBounds(): { x: number; y: number; width: number; height: number } {
    const [w, h] = this.win.getContentSize() as [number, number]
    return { x: -(w + 100), y: 0, width: w, height: h }
  }

  private isHealthy(managed: ManagedView): boolean {
    try {
      const wc = managed.view.webContents
      if (!wc || wc.isDestroyed()) return false
      if (typeof wc.isCrashed === 'function' && wc.isCrashed()) return false
      return true
    } catch {
      return false
    }
  }

  private noteIssue(siteId: string, category: RuntimeIssueCategory, reason: string): SiteRuntimeEvent {
    const now = Date.now()
    const prev = this.issueState.get(siteId)
    const count = prev && now - prev.lastAt < this.policy.windowMs ? prev.count + 1 : 1
    this.issueState.set(siteId, { count, lastAt: now })
    const recovery: RuntimeRecoveryAction =
      count <= this.policy.autoRecoverThreshold ? 'auto-recreate' : 'manual-check'
    this.recordStats(siteId, category, reason, now)
    const event: SiteRuntimeEvent = { siteId, category, reason, recovery, failureCount: count, ts: now }
    this.onRuntimeEvent?.(event)
    return event
  }

  private recordStats(siteId: string, category: RuntimeIssueCategory, reason: string, now: number): void {
    this.totals[category] += 1
    const existing = this.statsBySite.get(siteId) ?? {
      siteId,
      total: 0,
      recentInWindow: 0,
      byCategory: {
        'render-crash': { count: 0 },
        'webcontents-destroyed': { count: 0 },
        'network-fail': { count: 0 },
        'chat-interrupted': { count: 0 },
      },
    }
    existing.total += 1
    const stat = existing.byCategory[category]
    stat.count += 1
    stat.lastReason = reason
    stat.lastAt = now
    this.statsBySite.set(siteId, existing)
  }

  setRuntimeRecoveryPolicy(patch: Partial<RuntimeRecoveryPolicy>): RuntimeRecoveryPolicy {
    const nextWindow = Number.isFinite(patch.windowMs) ? Number(patch.windowMs) : this.policy.windowMs
    const nextThreshold = Number.isFinite(patch.autoRecoverThreshold)
      ? Number(patch.autoRecoverThreshold)
      : this.policy.autoRecoverThreshold
    this.policy = {
      windowMs: Math.max(10_000, Math.floor(nextWindow)),
      autoRecoverThreshold: Math.max(0, Math.floor(nextThreshold)),
    }
    return this.policy
  }

  getRuntimeRecoveryPolicy(): RuntimeRecoveryPolicy {
    return { ...this.policy }
  }

  getRuntimeStats(siteId?: string): RuntimeStatsSnapshot {
    const bySite: Record<string, SiteRuntimeStats> = {}
    for (const [id, stats] of this.statsBySite.entries()) {
      if (siteId && id !== siteId) continue
      bySite[id] = {
        siteId: stats.siteId,
        total: stats.total,
        recentInWindow: 0,
        byCategory: {
          'render-crash': { ...stats.byCategory['render-crash'] },
          'webcontents-destroyed': { ...stats.byCategory['webcontents-destroyed'] },
          'network-fail': { ...stats.byCategory['network-fail'] },
          'chat-interrupted': { ...stats.byCategory['chat-interrupted'] },
        },
      }
      const issue = this.issueState.get(id)
      if (issue && Date.now() - issue.lastAt < this.policy.windowMs) {
        bySite[id].recentInWindow = issue.count
      }
    }
    const totals: Record<RuntimeIssueCategory, number> = {
      'render-crash': 0,
      'webcontents-destroyed': 0,
      'network-fail': 0,
      'chat-interrupted': 0,
    }
    if (siteId) {
      const s = bySite[siteId]
      if (s) {
        totals['render-crash'] = s.byCategory['render-crash'].count
        totals['webcontents-destroyed'] = s.byCategory['webcontents-destroyed'].count
        totals['network-fail'] = s.byCategory['network-fail'].count
        totals['chat-interrupted'] = s.byCategory['chat-interrupted'].count
      }
    } else {
      totals['render-crash'] = this.totals['render-crash']
      totals['webcontents-destroyed'] = this.totals['webcontents-destroyed']
      totals['network-fail'] = this.totals['network-fail']
      totals['chat-interrupted'] = this.totals['chat-interrupted']
    }
    return { policy: this.getRuntimeRecoveryPolicy(), totals, bySite }
  }

  clearRuntimeStats(siteId?: string): void {
    if (siteId) {
      const s = this.statsBySite.get(siteId)
      if (s) {
        this.totals['render-crash'] -= s.byCategory['render-crash'].count
        this.totals['webcontents-destroyed'] -= s.byCategory['webcontents-destroyed'].count
        this.totals['network-fail'] -= s.byCategory['network-fail'].count
        this.totals['chat-interrupted'] -= s.byCategory['chat-interrupted'].count
      }
      this.statsBySite.delete(siteId)
      this.issueState.delete(siteId)
      return
    }
    this.statsBySite.clear()
    this.issueState.clear()
    this.totals['render-crash'] = 0
    this.totals['webcontents-destroyed'] = 0
    this.totals['network-fail'] = 0
    this.totals['chat-interrupted'] = 0
  }

  /** SSE/DOM reply pipeline: page started navigating while a send was in flight */
  reportChatInterrupted(siteId: string, reason: string): SiteRuntimeEvent {
    const ev = this.noteIssue(siteId, 'chat-interrupted', reason)
    log.warn('browser-view: chat interrupted during generation', ev)
    return ev
  }

  // ── Create / ensure ───────────────────────────────────────────────────────

  /**
   * Ensures a WebContentsView exists for this siteId.
   * If already created, returns it immediately (idempotent).
   * `initialLoginActive` restores the last-known connected state from the store
   * so ChatPage shows the correct status immediately on re-activation (TA-05).
   */
  ensure(siteId: string, url: string, initialLoginActive = false): ManagedView {
    if (this.views.has(siteId)) {
      const existing = this.views.get(siteId)!
      if (this.isHealthy(existing)) return existing
      log.warn('browser-view: unhealthy view detected during ensure, recreating', { siteId })
      return this.recover(siteId, url)
    }

    const session = getSession(siteId)
    const view = new WebContentsView({
      webPreferences: {
        session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    // Attach to main window as a child of its contentView.
    // Children render on top of the parent, but the view is positioned
    // off-screen so the user doesn't see it during normal chat.
    // A full-size rendering surface ensures rAF and layout APIs work normally.
    this.win.contentView.addChildView(view)
    view.setBounds(this.offScreenBounds())

    // Explicitly disable Chromium's background-tab throttling so that
    // requestAnimationFrame and timers run at full speed even when the view
    // is off-screen.  The visibilityState override in dom-ready patches the
    // JavaScript API, but setBackgroundThrottling(false) disables the
    // renderer-scheduler-level throttle that would otherwise freeze rAF.
    view.webContents.setBackgroundThrottling(false)

    // Load the site
    // §2.3-bis Phase 1: Install the fetch-interceptor bootstrap via CDP
    // Page.addScriptToEvaluateOnNewDocument BEFORE loadURL so the script is
    // registered before the page's HTML is fetched.  This is the same mechanism
    // Playwright uses for addInitScript — it runs before any page script,
    // guaranteeing our window.fetch wrapper is in place before ChatGPT/Claude's
    // JS bundle captures a reference to window.fetch at module-init time.
    // The CDP command completes in ~1 ms (local IPC) while the remote HTML
    // request takes ~100–500 ms, so there is no race in practice.
    const bootstrapSrc = buildBootstrapScript()
    try {
      view.webContents.debugger.attach('1.3')
      view.webContents.debugger
        .sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: bootstrapSrc })
        .catch((err: unknown) =>
          log.warn('browser-view: addScriptToEvaluateOnNewDocument failed', {
            siteId,
            err: String(err),
          }),
        )
    } catch (err) {
      log.warn('browser-view: debugger attach failed for bootstrap', { siteId, err: String(err) })
    }

    view.webContents.loadURL(url).catch((err) => {
      log.warn('browser-view: initial load failed', { siteId, err: String(err) })
    })

    // OAuth login flows (Google, Apple, GitHub…) use window.open() to open the
    // auth popup. Instead of denying (which silently breaks login), we load the
    // popup URL in the same view so the redirect completes normally.
    view.webContents.setWindowOpenHandler(({ url }) => {
      view.webContents.loadURL(url).catch(() => {})
      return { action: 'deny' }
    })

    // Override Visibility API on every navigation so the background page
    // always believes it is visible, preventing SPAs from throttling API calls.
    // Also override document.hasFocus() so AI sites (ChatGPT, Claude) don't
    // pause SSE streaming when they detect the tab lacks OS-level focus.
    const overrideScript = `
      Object.defineProperty(document, 'visibilityState', {
        get: function() { return 'visible'; }, configurable: true,
      });
      Object.defineProperty(document, 'hidden', {
        get: function() { return false; }, configurable: true,
      });
      document.hasFocus = function() { return true; };
    `
    view.webContents.on('dom-ready', () => {
      // Visibility / focus overrides (prevents AI sites from throttling SSE)
      view.webContents.executeJavaScript(overrideScript).catch(() => {})
      // §2.3-bis Phase 1 fallback: re-inject bootstrap if CDP path didn't run.
      // The bootstrap is guarded by `if (window.__autoAI) return` so this is
      // a no-op when Page.addScriptToEvaluateOnNewDocument succeeded.
      // Note: dom-ready fires after DOMContentLoaded, meaning deferred scripts
      // have already run — this fallback only helps if ChatGPT/Claude capture
      // window.fetch lazily (at interaction time, not at module init).
      view.webContents.executeJavaScript(bootstrapSrc).catch(() => {})
    })

    // Runtime issue classification hooks for health recovery.
    view.webContents.on('render-process-gone', (_e, details) => {
      const ev = this.noteIssue(siteId, 'render-crash', String(details?.reason ?? 'render-process-gone'))
      log.warn('browser-view: runtime issue', ev)
    })
    view.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
      if (!isMainFrame) return
      if (typeof code === 'number' && code >= 0) return
      const ev = this.noteIssue(siteId, 'network-fail', `${code}:${desc}`)
      log.warn('browser-view: runtime issue', ev)
    })

    const managed: ManagedView = {
      siteId,
      view,
      loginVisible: false,
      browseVisible: false,
      loginActive: initialLoginActive,
      loginPollInterval: null,
      loginPollNavCleanup: null,
    }
    this.views.set(siteId, managed)
    log.info('browser-view: created', { siteId, url })
    return managed
  }

  /**
   * Ensures a site view is healthy before interactive automation.
   * Recreates the underlying WebContentsView when destroyed/crashed.
   */
  ensureHealthy(siteId: string, url: string): ManagedView {
    const managed = this.views.get(siteId)
    if (!managed) return this.ensure(siteId, url)
    if (this.isHealthy(managed)) return managed
    const ev = this.noteIssue(siteId, 'webcontents-destroyed', 'webContents destroyed/crashed')
    if (ev.recovery === 'manual-check') return managed
    return this.recover(siteId, url)
  }

  isSiteHealthy(siteId: string): boolean {
    const managed = this.views.get(siteId)
    if (!managed) return false
    return this.isHealthy(managed)
  }

  private recover(siteId: string, url: string): ManagedView {
    const prev = this.views.get(siteId)
    const loginActive = prev?.loginActive ?? false
    const loginVisible = prev?.loginVisible ?? false
    const browseVisible = prev?.browseVisible ?? false
    if (prev) this.destroy(siteId)
    const next = this.ensure(siteId, url, loginActive)
    if (browseVisible) this.showBrowse(siteId)
    else if (loginVisible) this.showLogin(siteId)
    log.info('browser-view: recovered', { siteId, loginActive, browseVisible, loginVisible })
    return next
  }

  get(siteId: string): ManagedView | undefined {
    return this.views.get(siteId)
  }

  setLoginActive(siteId: string, active: boolean): void {
    const managed = this.views.get(siteId)
    if (!managed) return
    managed.loginActive = active
    this.onLoginActiveChange?.(siteId, active)
  }

  // ── Destroy ───────────────────────────────────────────────────────────────

  destroy(siteId: string): void {
    const managed = this.views.get(siteId)
    if (!managed) return
    if (managed.loginPollInterval) {
      clearInterval(managed.loginPollInterval)
    }
    if (managed.loginPollNavCleanup) {
      managed.loginPollNavCleanup()
    }
    // Guard against "Object has been destroyed" on window-all-closed:
    // Electron destroys child views automatically when the window closes,
    // so removeChildView may be called on an already-destroyed object.
    try {
      this.win.contentView.removeChildView(managed.view)
    } catch {
      // view already destroyed by Electron — safe to ignore
    }
    this.views.delete(siteId)
    log.info('browser-view: destroyed', { siteId })
  }

  // ── Show / hide login window ──────────────────────────────────────────────

  /**
   * Expands the WebContentsView to fill the main window so the user can log in.
   * The title bar area (40px) is preserved so the app's traffic lights remain visible.
   */
  showLogin(siteId: string): void {
    const managed = this.views.get(siteId)
    if (!managed) return

    // Move on-screen so the user can interact with the AI login page.
    // As a child of win.contentView it naturally renders on top of the React UI.
    const [winW, winH] = this.win.getContentSize() as [number, number]
    const TITLEBAR_H = 40
    managed.view.setBounds({
      x: 0,
      y: TITLEBAR_H,
      width: winW,
      height: winH - TITLEBAR_H,
    })
    managed.loginVisible = true
    log.info('browser-view: login shown', { siteId })
  }

  /**
   * Expands the BrowserView for calibration, leaving a 120px instruction
   * strip at the top for the renderer UI to show calibration guidance.
   */
  showCalibration(siteId: string): void {
    const managed = this.views.get(siteId)
    if (!managed) return

    // Move on-screen for the calibration click-capture flow.
    const [winW, winH] = this.win.getContentSize() as [number, number]
    const INSTRUCTION_H = 120
    managed.view.setBounds({
      x: 0,
      y: INSTRUCTION_H,
      width: winW,
      height: winH - INSTRUCTION_H,
    })
    managed.loginVisible = true
    log.info('browser-view: calibration shown', { siteId })
  }

  /** Returns the calibration view to off-screen full-size bounds (same as hideLogin). */
  hideCalibration(siteId: string): void {
    this.hideLogin(siteId)
  }

  /** Sends the login/calibration view back off-screen. Does NOT stop the login poll. */
  hideLogin(siteId: string): void {
    const managed = this.views.get(siteId)
    if (!managed) return

    // Restore to off-screen full-size bounds (rAF keeps running, view not visible)
    managed.view.setBounds(this.offScreenBounds())
    managed.loginVisible = false
    log.info('browser-view: login hidden', { siteId })
    // The view is off-screen (not at 0×0), so visibilityState stays 'visible'
    // naturally — no override needed.
  }

  stopLoginPoll(siteId: string): void {
    const managed = this.views.get(siteId)
    if (!managed) return
    if (managed.loginPollInterval) {
      clearInterval(managed.loginPollInterval)
      managed.loginPollInterval = null
    }
    if (managed.loginPollNavCleanup) {
      managed.loginPollNavCleanup()
      managed.loginPollNavCleanup = null
    }
  }

  /** Collapses ALL currently-visible login windows back to 0×0. */
  hideAllLogins(): void {
    for (const [, managed] of this.views) {
      if (managed.loginVisible) {
        this.hideLogin(managed.siteId)
      }
    }
  }

  // ── Browse mode (show actual website in tab) ─────────────────────────────

  /**
   * Shows the WebContentsView for `siteId` as the main content, hiding all
   * other views. This lets the user see and interact with the real AI website.
   * The 40px title-bar / tab-bar area is preserved.
   */
  showBrowse(siteId: string): void {
    // Send other browse views back off-screen (only one site on top at a time)
    for (const [id, m] of this.views) {
      if (id !== siteId && m.browseVisible) {
        m.view.setBounds(this.offScreenBounds())
        m.browseVisible = false
      }
    }

    const managed = this.views.get(siteId)
    if (!managed) return

    // Move on-screen so the user sees the AI website.
    const [winW, winH] = this.win.getContentSize() as [number, number]
    const TITLEBAR_H = 40
    managed.view.setBounds({
      x: 0,
      y: TITLEBAR_H,
      width: winW,
      height: winH - TITLEBAR_H,
    })
    managed.browseVisible = true
    log.info('browser-view: browse shown', { siteId })
  }

  /** Sends the browse view back off-screen. */
  hideBrowse(siteId: string): void {
    const managed = this.views.get(siteId)
    if (!managed) return

    managed.view.setBounds(this.offScreenBounds())
    managed.browseVisible = false
    log.info('browser-view: browse hidden', { siteId })
    // Off-screen (not 0×0) — visibilityState stays 'visible' naturally.
  }

  /** Returns the siteId whose browse view is currently visible, or null. */
  browseVisibleSiteId(): string | null {
    for (const [id, m] of this.views) {
      if (m.browseVisible) return id
    }
    return null
  }

  // ── Login detection polling ───────────────────────────────────────────────

  /**
   * Starts login detection for the given siteId.
   *
   * Detection priority (highest to lowest):
   * 1. URL pattern match (`loggedInUrlPattern`): fires immediately on navigation
   *    commit — no DOM query needed, zero timing window.
   * 2. Navigation events (did-navigate / did-navigate-in-page) + selector check:
   *    fires after OAuth redirect lands on a non-auth URL.
   * 3. did-finish-load: fires after all JS/CSS is loaded — catches heavy SPAs
   *    (e.g. ChatGPT) that render the input element after hydration.
   * 4. Immediate check (Strategy 0): handles "already logged in" sessions where
   *    no navigation event fires when the login view is re-shown.
   * 5. 1.5-second polling fallback: catches edge cases the above miss.
   *
   * The compound `inputSelector` covers both the site-specific preset and
   * generic fallbacks so minor DOM changes don't break detection.
   */
  startLoginPoll(
    siteId: string,
    inputSelector: string,
    onSuccess: () => void,
    loggedInUrlPattern?: RegExp,
  ): void {
    const managed = this.views.get(siteId)
    if (!managed) return

    // Clear any existing poll + nav listeners
    this.stopLoginPoll(siteId)

    // The caller (site:open-login) already built the compound selector via
    // buildInputSelector(). We add GENERIC_INPUT_SELECTOR as a safety net in
    // case a caller skipped that step (e.g. tests or future callers).
    const compoundSelector = inputSelector.includes(GENERIC_INPUT_SELECTOR)
      ? inputSelector
      : `${inputSelector}, ${GENERIC_INPUT_SELECTOR}`

    const deadline = Date.now() + 5 * 60 * 1000 // 5 min
    let resolved = false
    log.info('browser-view: login poll started', { siteId, selector: compoundSelector })

    const handleSuccess = (): void => {
      if (resolved) return
      resolved = true
      this.stopLoginPoll(siteId) // clears interval + nav listeners
      log.info('browser-view: login detected', { siteId })
      this.hideLogin(siteId)
      onSuccess()
    }

    const checkSelector = async (): Promise<void> => {
      if (resolved) return
      try {
        const url = managed.view.webContents.getURL()
        const found: boolean = await managed.view.webContents.executeJavaScript(`
          (function() {
            var sel = ${JSON.stringify(compoundSelector)};
            var el = document.querySelector(sel);
            if (!el) return false;
            var r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          })()
        `)
        log.debug('browser-view: checkSelector', { siteId, url, found })
        if (found) handleSuccess()
      } catch (err) {
        log.debug('browser-view: checkSelector error', { siteId, err: String(err) })
        // page may still be loading — ignore
      }
    }

    // Strategy 1: navigation-based detection.
    // URL pattern check fires immediately on nav commit — before any JS runs.
    // Falls back to selector check for custom sites without a loggedInUrlPattern.
    const AUTH_PATH_RE = /login|signin|signup|auth\.|accounts\.|oauth|sso|email.verif/i
    const navHandler = (_: unknown, url: string): void => {
      // Priority: URL pattern (no DOM needed, no timing window)
      if (loggedInUrlPattern?.test(url)) {
        // Wait 1.5 s before confirming — SPAs may client-side-redirect away from the
        // matched URL immediately after hydration (e.g. ChatGPT → email-verification).
        // Re-read the current URL after settling; only confirm if still on a valid page.
        setTimeout(() => {
          if (resolved) return
          const currentUrl = managed.view.webContents.getURL()
          if (loggedInUrlPattern.test(currentUrl) && !AUTH_PATH_RE.test(currentUrl)) {
            log.info('browser-view: login detected via URL pattern (nav)', { siteId, url: currentUrl })
            handleSuccess()
          } else {
            log.info('browser-view: URL pattern matched but page redirected away', { siteId, from: url, to: currentUrl })
          }
        }, 1500)
        return
      }
      if (AUTH_PATH_RE.test(url)) return // still on auth pages, ignore
      // Delay slightly so the page finishes initial render before we query the DOM
      setTimeout(() => { checkSelector().catch(() => {}) }, 1500)
    }
    managed.view.webContents.on('did-navigate', navHandler)
    managed.view.webContents.on('did-navigate-in-page', navHandler)

    // Strategy 1b: full-load detection.
    // did-navigate fires when navigation commits (URL changes) but before JS executes.
    // For SPAs with heavy JS bundles (e.g. ChatGPT), the input element is rendered
    // by React *after* the network response — which can be 2-3 s after did-navigate.
    // did-finish-load fires once all subresources (JS, CSS) are fetched and the DOM
    // is fully built, making it a reliable trigger for post-hydration selector checks.
    const finishLoadHandler = (): void => {
      const url = managed.view.webContents.getURL()
      if (loggedInUrlPattern?.test(url) && !AUTH_PATH_RE.test(url)) {
        log.info('browser-view: login detected via URL pattern (finish-load)', { siteId, url })
        handleSuccess()
        return
      }
      if (AUTH_PATH_RE.test(url)) return // still on auth pages, ignore
      setTimeout(() => { checkSelector().catch(() => {}) }, 500)
    }
    managed.view.webContents.on('did-finish-load', finishLoadHandler)

    managed.loginPollNavCleanup = (): void => {
      managed.view.webContents.off('did-navigate', navHandler)
      managed.view.webContents.off('did-navigate-in-page', navHandler)
      managed.view.webContents.off('did-finish-load', finishLoadHandler)
    }

    // Strategy 0: immediate check — handles the "already logged in" case where
    // the session cookie is still valid and the view is already at the post-login
    // page.  No navigation event fires in this scenario, so we must check right
    // away.  500 ms lets the DOM settle after the view becomes visible.
    setTimeout(() => {
      if (resolved) return
      const url = managed.view.webContents.getURL()
      if (loggedInUrlPattern?.test(url) && !AUTH_PATH_RE.test(url)) {
        log.info('browser-view: login detected via URL pattern (immediate)', { siteId, url })
        handleSuccess()
        return
      }
      checkSelector().catch(() => {})
    }, 500)

    // Strategy 2: polling fallback (covers cases where nav event already fired).
    managed.loginPollInterval = setInterval(async () => {
      if (resolved || Date.now() > deadline) {
        this.stopLoginPoll(siteId)
        if (!resolved) log.warn('browser-view: login poll timed out', { siteId })
        return
      }
      await checkSelector()
    }, 1500)
  }

  // ── Window resize ─────────────────────────────────────────────────────────

  /**
   * Called when the main window resizes.  Updates off-screen background
   * views so they always match the current window dimensions (rAF surface
   * stays full-size).
   */
  onWindowResize(): void {
    const bounds = this.offScreenBounds()
    for (const managed of this.views.values()) {
      if (!managed.loginVisible && !managed.browseVisible) {
        managed.view.setBounds(bounds)
      }
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Destroys all managed views (called on window-all-closed). */
  destroyAll(): void {
    for (const siteId of [...this.views.keys()]) {
      this.destroy(siteId)
    }
  }
}
