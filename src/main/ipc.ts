/* ------------------------------------------------------------------ */
/*  src/main/ipc.ts — All IPC handlers for site management (M2+M3)   */
/* ------------------------------------------------------------------ */

import { ipcMain, BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import log from 'electron-log'
import type { SiteConfig, SiteStatus } from './site-store'
import { SiteStore } from './site-store'
import { clearSession } from './session'
import { BrowserViewManager } from './browser-view'
import { buildInputSelector } from './selector-utils'
import { getChatBusy, setChatBusy, clearChatBusy } from './chat-busy'
import { dispatchChatSend } from './automation/chat-dispatcher'
import { applyToolToggle } from './automation/tool-toggle'
import { applyModelSwitch } from './automation/model-switch'
import { findPreset } from './presets'
import {
  assertSiteId,
  assertSiteUrl,
  normalizeOptionalLabel,
  assertChatText,
  assertSelectorFields,
  assertRenameLabel,
} from './security'
import type { NetworkDiagnosticsSnapshot } from './network-diagnostics'
import { getLastChatFailure, listRecentChatFailures, clearChatFailure } from './chat-failure-log'
import { getAutomationMetrics, resetAutomationMetrics } from './automation/metrics'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SiteWithStatus extends SiteConfig {
  status: SiteStatus
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerSiteIpc(
  win: BrowserWindow,
  store: SiteStore,
  bvm: BrowserViewManager,
  networkDiagnostics?: {
    getSnapshot: () => NetworkDiagnosticsSnapshot | null
    refresh?: () => Promise<void>
  },
): void {
  // ── site:add ───────────────────────────────────────────────────────────────
  // Adds a site to the store and creates a background WebContentsView.
  // Returns the new SiteConfig (including siteId) or { error } on failure.
  ipcMain.handle('site:add', (_event, urlStr: string, label?: string) => {
    // Validate at the IPC boundary — throws on bad input so ipcRenderer.invoke
    // rejects and the renderer's try/catch shows a proper error message instead
    // of silently receiving {error} and continuing with config.siteId = undefined.
    assertSiteUrl(urlStr)
    const normalizedLabel = normalizeOptionalLabel(label)
    try {
      const config = store.add(urlStr, normalizedLabel)
      bvm.ensure(config.siteId, config.url)
      log.info('ipc: site:add', { siteId: config.siteId, hostname: config.hostname })
      return config
    } catch (err) {
      log.error('ipc: site:add failed', { err: String(err) })
      throw err  // reject the invoke → renderer try/catch receives the error
    }
  })

  // ── site:remove ────────────────────────────────────────────────────────────
  // Destroys the view, clears the session, removes from store.
  ipcMain.handle('site:remove', async (_event, siteId: string) => {
    try {
      bvm.destroy(siteId)
      await clearSession(siteId)
      store.remove(siteId)
      log.info('ipc: site:remove', { siteId })
      // Notify renderer so ChatPage's local site list and App.tsx state refresh.
      win.webContents.send('site:status-changed', { siteId, status: 'disconnected' })
      return { ok: true }
    } catch (err) {
      log.error('ipc: site:remove failed', { err: String(err) })
      return { error: String(err) }
    }
  })

  // ── site:list ──────────────────────────────────────────────────────────────
  // Returns all stored sites with real-time status.
  ipcMain.handle('site:list', () => {
    const configs = store.list()
    const result: SiteWithStatus[] = configs.map((c) => ({
      ...c,
      status: resolveStatus(c, bvm),
    }))
    log.debug('ipc: site:list', result.map((r) => ({ siteId: r.siteId, status: r.status })))
    return result
  })

  // ── site:runtime-policy ────────────────────────────────────────────────────
  ipcMain.handle('site:get-runtime-policy', () => {
    return bvm.getRuntimeRecoveryPolicy()
  })
  ipcMain.handle(
    'site:set-runtime-policy',
    (_event, patch: { windowMs?: number; autoRecoverThreshold?: number }) => {
      return bvm.setRuntimeRecoveryPolicy(patch ?? {})
    },
  )

  // ── site:runtime-stats ─────────────────────────────────────────────────────
  ipcMain.handle('site:get-runtime-stats', (_event, siteId?: string) => {
    return bvm.getRuntimeStats(siteId)
  })
  ipcMain.handle('site:clear-runtime-stats', (_event, siteId?: string) => {
    bvm.clearRuntimeStats(siteId)
    return { ok: true }
  })
  ipcMain.handle('site:get-network-diagnostics', () => networkDiagnostics?.getSnapshot?.() ?? null)

  ipcMain.handle('site:refresh-network-diagnostics', async () => {
    await networkDiagnostics?.refresh?.()
    return networkDiagnostics?.getSnapshot?.() ?? null
  })

  ipcMain.handle('site:get-last-chat-failure', () => getLastChatFailure())
  ipcMain.handle('site:list-recent-chat-failures', (_event, limit?: number) => listRecentChatFailures(limit ?? 20))
  ipcMain.handle('site:clear-chat-failures', () => {
    clearChatFailure()
    return { ok: true }
  })
  ipcMain.handle('site:get-automation-metrics', () => getAutomationMetrics())
  ipcMain.handle('site:reset-automation-metrics', () => {
    resetAutomationMetrics()
    return { ok: true }
  })

  // ── site:open-login ────────────────────────────────────────────────────────
  // Expands the WebContentsView so the user can log in.
  // Starts polling for login completion; emits site:login-success to renderer.
  ipcMain.handle('site:open-login', (_event, siteId: string) => {
    const config = store.get(siteId)
    if (!config) return { error: 'site not found' }

    bvm.ensure(siteId, config.url)

    const preset = findPreset(config.hostname)
    const managed = bvm.get(siteId)

    // Fast-path: if the site is already marked active AND the current URL still
    // matches the logged-in pattern, skip the overlay entirely.  This handles:
    //   1. ··· → 重新登录 clicked on a site whose session is still valid.
    //   2. Race condition: probe marks site as loginActive just before the user
    //      clicks the "登录" button that was visible before the probe result arrived.
    // If the session HAS expired (URL is on an auth page), the check fails and we
    // fall through to the normal login-poll flow so the user can re-authenticate.
    const AUTH_RE = /login|signin|signup|auth\.|accounts\.|oauth|sso|email.verif/i
    if (managed?.loginActive) {
      const currentUrl = managed.view.webContents.getURL()
      if (preset?.loggedInUrlPattern?.test(currentUrl) && !AUTH_RE.test(currentUrl)) {
        log.info('ipc: site:open-login — already active, fast-path', { siteId, url: currentUrl })
        win.webContents.send('site:login-success', { siteId })
        win.webContents.send('site:status-changed', {
          siteId,
          status: resolveStatus(store.get(siteId) ?? config, bvm),
        })
        return { ok: true }
      }
    }

    bvm.showLogin(siteId)

    // Notify renderer immediately so it can show a cancel button in the top bar.
    // resolveStatus now returns 'loading' because loginVisible === true.
    win.webContents.send('site:status-changed', {
      siteId,
      status: resolveStatus(store.get(siteId) ?? config, bvm),
    })

    // Clear any stale quota flag when re-logging in
    store.setQuotaExhausted(siteId, false)

    // Use the same compound selector as probeOneSite so both the site-specific
    // preset and generic fallbacks are tried.  buildInputSelector guarantees a
    // non-empty selector even for custom sites without a configured selector.
    const inputSelector = buildInputSelector(config)
    bvm.startLoginPoll(siteId, inputSelector, () => {
      bvm.setLoginActive(siteId, true)
      win.webContents.send('site:login-success', { siteId })
      win.webContents.send('site:status-changed', {
        siteId,
        status: resolveStatus(store.get(siteId) ?? config, bvm),
      })
    }, preset?.loggedInUrlPattern)

    log.info('ipc: site:open-login', { siteId })
    return { ok: true }
  })

  // ── site:close-login ───────────────────────────────────────────────────────
  // Manually hides the login view (user closed the panel).
  // Before stopping the poll we do one immediate selector check — if the user
  // completed login (OAuth redirect etc.) but the poll hadn't fired yet, we
  // still mark them as logged-in.
  ipcMain.handle('site:close-login', async (_event, siteId: string) => {
    const config = store.get(siteId)
    if (config) {
      const inputSelector = buildInputSelector(config)
      const managed = bvm.get(siteId)
      if (managed && !managed.loginActive) {
        try {
          const found: boolean = await managed.view.webContents.executeJavaScript(`
            (function() {
              var el = document.querySelector(${JSON.stringify(inputSelector)});
              if (!el) return false;
              var r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            })()
          `)
          if (found) {
            bvm.setLoginActive(siteId, true)
            win.webContents.send('site:login-success', { siteId })
            win.webContents.send('site:status-changed', {
              siteId,
              status: resolveStatus(store.get(siteId) ?? config, bvm),
            })
          }
        } catch { /* page not ready, ignore */ }
      }
    }
    bvm.stopLoginPoll(siteId)
    bvm.hideLogin(siteId)
    log.info('ipc: site:close-login', { siteId })
    return { ok: true }
  })

  // ── site:close-all-logins ─────────────────────────────────────────────────
  // Hides every currently-visible login WebContentsView (used by the ⚙ button
  // so the user can always escape the login flow and return to ResourcesPage).
  // Same as close-login: does an immediate selector check per site first.
  ipcMain.handle('site:close-all-logins', async () => {
    const checks: Promise<void>[] = []
    for (const config of store.list()) {
      const siteId = config.siteId
      const managed = bvm.get(siteId)
      if (!managed?.loginVisible) continue
      const inputSelector = buildInputSelector(config)
      checks.push(
        (async () => {
          if (!managed.loginActive) {
            try {
              const found: boolean = await managed.view.webContents.executeJavaScript(`
                (function() {
                  var el = document.querySelector(${JSON.stringify(inputSelector)});
                  if (!el) return false;
                  var r = el.getBoundingClientRect();
                  return r.width > 0 && r.height > 0;
                })()
              `)
              if (found) {
                bvm.setLoginActive(siteId, true)
                win.webContents.send('site:login-success', { siteId })
                win.webContents.send('site:status-changed', {
                  siteId,
                  status: resolveStatus(store.get(siteId) ?? config, bvm),
                })
              }
            } catch { /* ignore */ }
          }
          bvm.stopLoginPoll(siteId)
        })()
      )
    }
    await Promise.all(checks)
    bvm.hideAllLogins()
    log.info('ipc: site:close-all-logins')
    return { ok: true }
  })

  // ── site:update-selectors ──────────────────────────────────────────────────
  // Updates selector chains from calibration UI or detector.
  ipcMain.handle(
    'site:update-selectors',
    (_event, siteId: string, fields: unknown, source: 'detector' | 'user' = 'user') => {
      let validSiteId: string
      let validFields: ReturnType<typeof assertSelectorFields>
      try {
        validSiteId = assertSiteId(siteId)
        validFields = assertSelectorFields(fields)
      } catch (err) {
        log.warn('ipc: site:update-selectors — validation failed', { err: String(err) })
        return { error: String(err) }
      }
      store.updateSelectors(validSiteId, validFields, source)
      log.info('ipc: site:update-selectors', { siteId: validSiteId, source })
      return { ok: true }
    },
  )

  // ── site:rename ────────────────────────────────────────────────────────────
  // Renames a site's display label.
  ipcMain.handle('site:rename', (_event, siteId: string, label: string) => {
    let validSiteId: string
    let validLabel: string
    try {
      validSiteId = assertSiteId(siteId)
      validLabel = assertRenameLabel(label)
    } catch (err) {
      log.warn('ipc: site:rename — validation failed', { err: String(err) })
      return { error: String(err) }
    }
    store.rename(validSiteId, validLabel)
    log.info('ipc: site:rename', { siteId: validSiteId, label: validLabel })
    win.webContents.send('site:status-changed', {
      siteId: validSiteId,
      status: resolveStatus(store.get(validSiteId)!, bvm),
    })
    return { ok: true }
  })

  // ── site:show-view ─────────────────────────────────────────────────────────
  // Shows the real AI website in a WebContentsView below the tab bar.
  ipcMain.handle('site:show-view', (_event, siteId: string) => {
    bvm.showBrowse(siteId)
    log.info('ipc: site:show-view', { siteId })
    return { ok: true }
  })

  // ── site:hide-view ─────────────────────────────────────────────────────────
  // Hides the WebContentsView, returning to the React chat UI.
  ipcMain.handle('site:hide-view', (_event, siteId: string) => {
    bvm.hideBrowse(siteId)
    log.info('ipc: site:hide-view', { siteId })
    return { ok: true }
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveStatus(config: SiteConfig, bvm: BrowserViewManager): SiteStatus {
  // Persisted quota flag takes highest precedence
  if (config.quotaExhausted) return 'quota-exhausted'

  const managed = bvm.get(config.siteId)
  if (!managed) return 'disconnected'

  // Login window visible → user is actively logging in
  if (managed.loginVisible) return 'loading'

  // Startup probe / login poll has not confirmed a live session yet
  if (!managed.loginActive) return 'disconnected'

  return 'connected'
}

// ─── Chat IPC (M3) ────────────────────────────────────────────────────────────

export function registerChatIpc(
  win: BrowserWindow,
  store: SiteStore,
  bvm: BrowserViewManager,
): void {
  // ── chat:send ──────────────────────────────────────────────────────────────
  // Delegates to automation engine (legacy fetch-wrapper vs Playwright CDP SSE).
  ipcMain.handle('chat:send', async (_event, siteId: string, text: string) => {
    if (getChatBusy()) {
      log.warn('ipc: chat:send rejected — busy', { siteId })
      return { error: 'busy' }
    }

    let validSiteId: string
    let validText: string
    try {
      validSiteId = assertSiteId(siteId)
      validText = assertChatText(text)
    } catch (err) {
      log.warn('ipc: chat:send — validation failed', { err: String(err) })
      return { error: String(err) }
    }

    const config = store.get(validSiteId)
    if (!config) return { error: 'site not found' }

    const managed = bvm.ensureHealthy(validSiteId, config.url)
    if (!managed) return { error: 'no browser view for site' }
    if (!bvm.isSiteHealthy(validSiteId)) {
      log.warn('ipc: chat:send rejected — browser runtime unhealthy', { siteId: validSiteId })
      return { error: 'runtime-unhealthy' }
    }

    setChatBusy(true)
    log.info('ipc: chat:send', { siteId: validSiteId, textLen: validText.length })

    try {
      managed.view.webContents.focus()
      const out = await dispatchChatSend({
        win,
        store,
        bvm,
        validSiteId,
        validText,
        managed,
      })
      return 'error' in out ? out : { ok: true, sendSeq: out.sendSeq }
    } catch (err) {
      clearChatBusy()
      log.error('ipc: chat:send exception', { siteId: validSiteId, err: String(err) })
      return { error: String(err) }
    }
  })
}

/** @deprecated Prefer clearChatBusy — kept for comments referencing M4 */
export function clearBusy(): void {
  clearChatBusy()
}

// ─── Chat model IPC (M11) ─────────────────────────────────────────────────────

export function registerChatModelIpc(
  win: BrowserWindow,
  store: SiteStore,
  bvm: BrowserViewManager,
): void {
  // ── chat:switch-model ──────────────────────────────────────────────────────
  // Clicks the model switcher button in the AI page, then clicks the target
  // model option. On success, persists the new model and returns { ok, modelLabel }.
  // Returns { error: 'busy' } if a generation is in progress.
  ipcMain.handle('chat:switch-model', async (_event, siteId: string, modelId: string) => {
    if (getChatBusy()) {
      log.warn('ipc: chat:switch-model rejected — busy', { siteId })
      return { error: 'busy' }
    }

    const config = store.get(siteId)
    if (!config) return { error: 'site not found' }
    if (!config.modelSwitcherSelector) return { error: 'model-switching-not-supported' }
    if (!config.availableModels?.length) return { error: 'no-models-configured' }

    const model = config.availableModels.find((m) => m.id === modelId)
    if (!model) return { error: 'model-not-found' }

    const managed = bvm.get(siteId)
    if (!managed) return { error: 'no browser view for site' }

    const result = await applyModelSwitch(managed.view.webContents, config, modelId)
    if (!result.ok) {
      log.warn('ipc: chat:switch-model failed', { siteId, modelId, reason: result.reason })
      return { error: result.reason ?? 'model-option-not-found' }
    }

    store.setActiveModel(siteId, modelId)
    // Notify renderer so it can update displayed model name
    win.webContents.send('site:status-changed', {
      siteId,
      status: resolveStatus(store.get(siteId) ?? config, bvm),
    })
    return { ok: true, modelLabel: result.modelLabel ?? model.label }
  })

  // ── chat:list-models ───────────────────────────────────────────────────────
  // Returns the available models and currently active model for a site.
  ipcMain.handle('chat:list-models', (_event, siteId: string) => {
    const config = store.get(siteId)
    if (!config) return { error: 'site not found' }
    return {
      models: config.availableModels ?? [],
      activeModel: config.activeModel,
    }
  })

  // ── chat:list-tools ──────────────────────────────────────────────────────
  // M12: Returns the one-click tools (深度思考 / 联网搜索 …) and which are ON.
  ipcMain.handle('chat:list-tools', (_event, siteId: string) => {
    const config = store.get(siteId)
    if (!config) return { error: 'site not found' }
    return {
      tools: config.toolToggles ?? [],
      activeTools: config.activeTools ?? [],
    }
  })

  // ── chat:toggle-tool ───────────────────────────────────────────────────────
  // M12: Turn a composer tool on/off on the live page. Mirrors chat:switch-model:
  //   • rejected while a generation is in progress (busy)
  //   • opens the containing menu first when the tool lives in one
  //   • reads the control's state and clicks only when needed
  //   • persists the resolved on/off into activeTools so task execution re-applies it
  // `enable` omitted = pure flip.
  ipcMain.handle(
    'chat:toggle-tool',
    async (_event, siteId: string, toolId: string, enable?: boolean) => {
      if (getChatBusy()) {
        log.warn('ipc: chat:toggle-tool rejected — busy', { siteId, toolId })
        return { error: 'busy' }
      }

      const config = store.get(siteId)
      if (!config) return { error: 'site not found' }
      const tool = config.toolToggles?.find((t) => t.id === toolId)
      if (!tool) return { error: 'tool-not-found' }

      const managed = bvm.get(siteId)
      if (!managed) return { error: 'no browser view for site' }

      const result = await applyToolToggle(managed.view.webContents, tool, enable)
      if (!result.ok) {
        log.warn('ipc: chat:toggle-tool failed', { siteId, toolId, reason: result.reason })
        return { error: result.reason ?? 'toggle-failed' }
      }

      // Resolve the effective on/off and persist it. Prefer the explicit request;
      // otherwise fall back to the state read back from the page.
      const effective =
        enable !== undefined ? enable : typeof result.state === 'boolean' ? result.state : undefined
      let activeTools = config.activeTools ?? []
      if (effective !== undefined) {
        activeTools = store.setToolActive(siteId, toolId, effective)
      }

      log.info('ipc: chat:toggle-tool — ok', { siteId, toolId, effective, clicked: result.clicked })
      return { ok: true, toolId, enabled: effective, state: result.state, activeTools }
    },
  )
}

// ─── Shared helpers ──────────────────────────────────────────────────────────
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ─── M6: Startup login probe + site:check-quota IPC ─────────────────────────

/**
 * Probe every stored site in background after app start.
 * Checks if the input selector is visible (= user is still logged in).
 * Pushes site:status-changed to the renderer for each result.
 */
export async function probeAllSites(
  win: BrowserWindow,
  store: SiteStore,
  bvm: BrowserViewManager,
): Promise<void> {
  // Give views time to start loading before we probe
  // Allow tests to shorten the startup delay via env var (e.g. AUTOAI_PROBE_DELAY=500)
  const probeDelay = parseInt(process.env['AUTOAI_PROBE_DELAY'] ?? '5000', 10)
  await delay(probeDelay)
  for (const config of store.list()) {
    probeOneSite(config.siteId, win, store, bvm).catch(() => {})
  }
}

/**
 * Checks whether a site's quota-exhausted indicator is visible on the page.
 * `indicator` may contain multiple `||`-separated candidates — if ANY matches,
 * returns `true` (quota exhausted).
 * Returns `null` if the check could not be run (no indicator, JS error, etc.).
 */
async function checkQuotaOnPage(
  managed: ReturnType<BrowserViewManager['get']>,
  indicator: string | undefined,
): Promise<boolean | null> {
  if (!managed || !indicator) return null
  // Split into individual candidates; run as a single executeJavaScript call
  const candidates = indicator.split('||').map((s) => s.trim()).filter(Boolean)
  if (!candidates.length) return null
  try {
    const found: boolean = await managed.view.webContents.executeJavaScript(`
      (function() {
        var candidates = ${JSON.stringify(candidates)};
        var bodyText = null;
        for (var i = 0; i < candidates.length; i++) {
          var q = candidates[i];
          if (!q) continue;
          try {
            if (q.startsWith('text=')) {
              if (bodyText === null) bodyText = document.body.innerText || document.body.textContent || '';
              if (bodyText.toLowerCase().includes(q.slice(5).toLowerCase())) return true;
            } else {
              if (document.querySelector(q)) return true;
            }
          } catch(e) {}
        }
        return false;
      })()
    `)
    return found
  } catch {
    return null
  }
}

async function probeOneSite(
  siteId: string,
  win: BrowserWindow,
  store: SiteStore,
  bvm: BrowserViewManager,
): Promise<void> {
  const config = store.get(siteId)
  if (!config) return
  const managed = bvm.get(siteId)
  if (!managed) return

  // Wait up to 8 s for page to finish loading
  const loadDeadline = Date.now() + 8_000
  while (managed.view.webContents.isLoading() && Date.now() < loadDeadline) {
    await delay(500)
  }

  // Phase B: URL pattern check — fastest and most reliable signal.
  // If the current URL matches the preset's loggedInUrlPattern, we know the
  // user is already logged in without querying the DOM at all.
  const preset = findPreset(config.hostname)
  const currentUrl = managed.view.webContents.getURL()
  if (preset?.loggedInUrlPattern?.test(currentUrl)) {
    bvm.setLoginActive(siteId, true)
    log.info('probe: login detected via URL pattern', { siteId, url: currentUrl })

    // Check quota immediately after confirming login.
    // A "logged in" session may already be in quota-exhausted state (e.g. free
    // tier used up before the app was restarted).  Without this check the site
    // would appear as `connected` but every send attempt would fail.
    const latestConfig = store.get(siteId) ?? config
    const quotaExhausted = await checkQuotaOnPage(managed, latestConfig.quotaExhaustedIndicator)
    if (quotaExhausted === true) {
      store.setQuotaExhausted(siteId, true)
      log.info('probe: quota exhausted detected on login', { siteId })
    }

    if (!win.isDestroyed()) {
      win.webContents.send('site:status-changed', {
        siteId,
        status: resolveStatus(store.get(siteId) ?? config, bvm),
      })
    }
    return
  }

  // Use the compound selector (same as startLoginPoll) so that minor DOM
  // changes (e.g. Claude dropping data-placeholder) don't break detection.
  const probeSelector = buildInputSelector(config)

  try {
    // Views now run at full window size behind the React UI, so layout-based
    // APIs (getBoundingClientRect) return correct values.  Check both element
    // existence AND visible dimensions so we don't false-positive on hidden
    // placeholder inputs that exist on login pages.
    const visible: boolean = await managed.view.webContents.executeJavaScript(`
      (function() {
        var el = document.querySelector(${JSON.stringify(probeSelector)});
        if (!el) return false;
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })()
    `)
    bvm.setLoginActive(siteId, visible)
    log.info('probe: login status', { siteId, active: visible })

    // If DOM probe says logged in, also check quota.
    if (visible) {
      const latestConfig = store.get(siteId) ?? config
      const quotaExhausted = await checkQuotaOnPage(managed, latestConfig.quotaExhaustedIndicator)
      if (quotaExhausted === true) {
        store.setQuotaExhausted(siteId, true)
        log.info('probe: quota exhausted detected on login (dom path)', { siteId })
      }
    }
  } catch (err) {
    log.warn('probe: executeJavaScript failed', { siteId, err: String(err) })
    bvm.setLoginActive(siteId, false)
  }

  if (!win.isDestroyed()) {
    const fresh = store.get(siteId) ?? config
    win.webContents.send('site:status-changed', {
      siteId,
      status: resolveStatus(fresh, bvm),
    })
  }
}

/**
 * Registers site:check-quota IPC.
 * Probes the page for quotaExhaustedIndicator; if gone, clears the flag.
 */
export function registerStatusIpc(
  win: BrowserWindow,
  store: SiteStore,
  bvm: BrowserViewManager,
): void {
  ipcMain.handle('site:check-quota', async (_event, siteId: string) => {
    const config = store.get(siteId)
    if (!config) return { error: 'site not found' }
    if (!config.quotaExhaustedIndicator) return { error: 'no indicator configured' }

    const managed = bvm.get(siteId)
    if (!managed) return { error: 'no browser view' }

    const indicator = config.quotaExhaustedIndicator
    try {
      const found = await checkQuotaOnPage(managed, indicator)
      if (found === null) return { error: 'check failed' }

      if (!found) {
        store.setQuotaExhausted(siteId, false)
        // Also re-probe login state so status can become 'connected'
        await probeOneSite(siteId, win, store, bvm)
      }

      return { cleared: !found }
    } catch (err) {
      return { error: String(err) }
    }
  })
}

// ─── Calibration IPC (M5) ─────────────────────────────────────────────────────

/** Per-siteId cancel signals for the two-step calibration flow. */
const calibrateCancels = new Map<string, boolean>()

export function registerCalibrateIpc(
  win: BrowserWindow,
  store: SiteStore,
  bvm: BrowserViewManager,
): void {
  // ── calibrate:start ──────────────────────────────────────────────────────
  ipcMain.handle('calibrate:start', async (_event, siteId: string) => {
    calibrateCancels.set(siteId, false)

    const config = store.get(siteId)
    if (!config) return { error: 'site not found' }

    // Ensure the BrowserView exists and is loaded
    const managed = bvm.get(siteId) ?? bvm.ensure(siteId, config.url)

    // Show the view leaving 120px at top for renderer instruction strip
    bvm.showCalibration(siteId)

    try {
      // Step 1: capture the input field
      win.webContents.send('calibrate:step', { step: 1, instruction: '请点击你输入消息的地方' })
      const inputSelector = await captureClick(managed.view.webContents, siteId)
      if (!inputSelector) {
        bvm.hideCalibration(siteId)
        return { error: 'cancelled' }
      }

      // Step 2: capture the response container
      win.webContents.send('calibrate:step', { step: 2, instruction: '请点击一条 AI 的回复' })
      const responseSelector = await captureClick(managed.view.webContents, siteId)
      if (!responseSelector) {
        bvm.hideCalibration(siteId)
        return { error: 'cancelled' }
      }

      // Persist both as priority-10 (user calibration), mark calibrated:true.
      // The preset responseSelectors (priority 5) are merged in as fallbacks so
      // that if the user accidentally clicked a non-response element (e.g. an SVG
      // icon), the response-watcher still has the preset selector as a tier-2 fallback.
      const existingConfig = store.get(siteId)
      const presetForSite = findPreset(existingConfig?.hostname ?? '')
      const fallbackResponseSelectors = presetForSite?.responseSelectors ?? []
      store.updateSelectors(
        siteId,
        {
          inputSelectors: [{ selector: inputSelector, method: 'css', priority: 10, failCount: 0 }],
          responseSelectors: [
            { selector: responseSelector, method: 'css', priority: 10, failCount: 0 },
            ...fallbackResponseSelectors.filter((s) => s.selector !== responseSelector),
          ],
        },
        'user',
      )

      bvm.hideCalibration(siteId)
      win.webContents.send('calibrate:done', siteId)
      log.info('ipc: calibrate:done', { siteId, inputSelector, responseSelector })
      return { ok: true }
    } catch (err) {
      bvm.hideCalibration(siteId)
      log.error('ipc: calibrate:start error', { siteId, err: String(err) })
      return { error: String(err) }
    } finally {
      calibrateCancels.delete(siteId)
    }
  })

  // ── calibrate:cancel ─────────────────────────────────────────────────────
  ipcMain.handle('calibrate:cancel', (_event, siteId: string) => {
    calibrateCancels.set(siteId, true)
    log.info('ipc: calibrate:cancel', { siteId })
    return { ok: true }
  })
}

// ─── Click-capture helper ─────────────────────────────────────────────────────

/**
 * Injects a click-capture script into the WebContents and polls until
 * the user clicks an element (or cancels / times out).
 * Returns the generated CSS selector, or null on cancel/timeout.
 */
async function captureClick(wc: WebContents, siteId: string): Promise<string | null> {
  const captureScript = `(function() {
    window.__autoAI_calibrateCapture = null;
    var hovered = null;
    function clearHL(el) { if (el) { el.style.outline = ''; el.style.outlineOffset = ''; } }
    function onOver(e) {
      clearHL(hovered);
      e.target.style.outline = '3px solid rgba(59,130,246,0.85)';
      e.target.style.outlineOffset = '2px';
      hovered = e.target;
    }
    function genSel(el) {
      if (!el || el.nodeType !== 1) return 'body';
      if (el.id) {
        try {
          var eid = '#' + CSS.escape(el.id);
          if (document.querySelectorAll(eid).length === 1) return eid;
        } catch(e) {}
      }
      var path = []; var cur = el;
      while (cur && cur !== document.body && path.length < 8) {
        var tag = cur.tagName.toLowerCase();
        var parent = cur.parentElement;
        if (!parent) break;
        var sibs = Array.from(parent.children).filter(function(c) { return c.tagName === cur.tagName; });
        path.unshift(sibs.length > 1 ? tag + ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')' : tag);
        cur = parent;
      }
      return path.join(' > ') || 'body';
    }
    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('click', onClick, true);
      clearHL(hovered);
      e.target.style.outline = '3px solid rgba(34,197,94,0.9)';
      e.target.style.outlineOffset = '2px';
      window.__autoAI_calibrateCapture = genSel(e.target);
      setTimeout(function() { clearHL(e.target); }, 1200);
    }
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('click', onClick, true);
    true;
  })()`

  try {
    await wc.executeJavaScript(captureScript)
  } catch (err) {
    log.warn('captureClick: inject failed', { err: String(err) })
    return null
  }

  // Poll every 500ms; bail on cancel or 2-minute hard timeout
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (calibrateCancels.get(siteId)) return null
    await new Promise<void>((r) => setTimeout(r, 500))
    try {
      const result: string | null = await wc.executeJavaScript('window.__autoAI_calibrateCapture ?? null')
      if (result) {
        // Clear the global so it doesn't persist in the target site's DOM
        wc.executeJavaScript('window.__autoAI_calibrateCapture = null').catch(() => {})
        return result
      }
    } catch {
      // Page navigated or crashed — bail
      return null
    }
  }
  return null
}

/** Re-exported for ipc.*.test.ts — implementations live in chat-reply-race.ts */
export {
  raceReply,
  networkInterceptorAccepted,
  pickReply,
  deriveTimeoutHintFromText,
  getTimeoutFailureHint,
} from './chat-reply-race'
