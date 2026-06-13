/* ------------------------------------------------------------------ */
/*  src/main/network-interceptor.ts — SSE stream interceptor (§2.3-bis) */
/*                                                                        */
/*  Two-phase design (fixes the "ChatGPT pre-captures window.fetch"      */
/*  problem):                                                             */
/*                                                                        */
/*  Phase 1 — Bootstrap (installed BEFORE page JS runs):                 */
/*   buildBootstrapScript() returns an IIFE that replaces window.fetch   */
/*   and installs window.__autoAI.arm().  browser-view.ts registers it   */
/*   via CDP Page.addScriptToEvaluateOnNewDocument (runs before any page */
/*   script) and re-injects at dom-ready as a belt-and-suspenders        */
/*   fallback.                                                            */
/*                                                                        */
/*  Phase 2 — Arm (called at chat:send time, before inject()):           */
/*   interceptReply() calls executeJavaScript("window.__autoAI.arm(…)")  */
/*   which sets the URL pattern/extractor and returns a Promise that      */
/*   resolves when the next matching SSE stream ends.                     */
/*                                                                        */
/*  Why CDP Page.addScriptToEvaluateOnNewDocument:                        */
/*   ChatGPT and Claude capture window.fetch in their JS bundle at module */
/*   init time (DOMContentLoaded is already too late).  CDP's             */
/*   addScriptToEvaluateOnNewDocument injects our bootstrap before any    */
/*   page script — the same mechanism used by Playwright's addInitScript. */
/* ------------------------------------------------------------------ */

import log from 'electron-log'
import type { WebContentsView } from 'electron'
import { networkInterceptorAccepted } from './chat-reply-race'
import { startSseDebuggerTap } from './network-sse-cdp'
import type { WatchResult } from './response-watcher'

const PROCESS_TIMEOUT_MS = 120_000  // main-process hard cap (arm Promise race)

/** Merge in-page fetch arm with CDP Network tap — first accepted wins; preserve bootstrap-missing for legacy retry. */
function mergeFetchAndCdp(
  fetchP: Promise<WatchResult>,
  cdpP: Promise<WatchResult | null>,
): Promise<WatchResult> {
  return new Promise((resolve) => {
    let settled = false
    let fetchDone = false
    let cdpDone = false
    let fetchResult: WatchResult | undefined

    const resolveOnce = (r: WatchResult): void => {
      if (settled) return
      settled = true
      resolve(r)
    }

    const tryAccept = (r: WatchResult | null | undefined): void => {
      if (settled || r == null) return
      if (networkInterceptorAccepted(r)) resolveOnce(r)
    }

    const checkBothDone = (): void => {
      if (settled || !fetchDone || !cdpDone) return
      const out: WatchResult = { text: '', timedOut: true }
      if (fetchResult?._interceptReason === 'bootstrap-missing') {
        out._interceptReason = 'bootstrap-missing'
      }
      resolveOnce(out)
    }

    fetchP
      .then((r) => {
        fetchResult = r
        tryAccept(r)
      })
      .catch(() => {
        fetchResult = { text: '', timedOut: true, _interceptReason: 'arm-failed' }
      })
      .finally(() => {
        fetchDone = true
        checkBothDone()
      })

    cdpP
      .then((r) => tryAccept(r))
      .catch(() => {})
      .finally(() => {
        cdpDone = true
        checkBothDone()
      })
  })
}

// ─── Phase 1: Bootstrap ───────────────────────────────────────────────────────

/**
 * Returns a self-contained IIFE that installs a persistent window.fetch
 * wrapper and exposes window.__autoAI.arm(pattern, extractor, timeoutMs).
 *
 * Must be injected before page scripts run (via CDP
 * Page.addScriptToEvaluateOnNewDocument).  Guarded by
 * `if (window.__autoAI) return` so dom-ready fallback injection is a no-op
 * when the CDP path already ran.
 */
export function buildBootstrapScript(): string {
  return `(function() {
  if (window.__autoAI) return;  // already installed (CDP ran first)
  var _origFetch = window.fetch;
  if (!_origFetch) return;

  var ai = {
    _armed:     false,
    _settled:   false,
    _pattern:   null,
    _extractFn: null,
    _resolve:   null,
    _timeoutId: null,

    arm: function(patternStr, extractorBody, timeoutMs) {
      var self = this;
      // Cancel any previous outstanding arm (e.g. user sent again before reply)
      if (self._resolve) {
        clearTimeout(self._timeoutId);
        self._resolve({ text: '', timedOut: false });
        self._resolve = null;
      }
      self._settled   = false;
      self._armed     = false;
      self._pattern   = null;
      self._extractFn = null;

      try { self._pattern = new RegExp(patternStr); }
      catch(e) { return null; }  // invalid pattern — caller gets null → DOM fallback

      try { self._extractFn = new Function('line', extractorBody); }
      catch(e) { /* use built-in fallback below */ }

      return new Promise(function(resolve) {
        self._resolve = resolve;
        self._armed   = true;
        self._timeoutId = setTimeout(function() {
          self._finish('', true);
        }, timeoutMs || 119000);
      });
    },

    _finish: function(text, timedOut) {
      if (this._settled) return;
      this._settled = true;
      this._armed   = false;
      clearTimeout(this._timeoutId);
      if (this._resolve) {
        this._resolve({ text: text, timedOut: !!timedOut });
        this._resolve = null;
      }
    },

    _extract: function(line) {
      if (line === '[DONE]') return null;
      // Custom extractor first
      if (this._extractFn) {
        try {
          var r = this._extractFn(line);
          return typeof r === 'string' ? r : null;
        } catch(e) {}
      }
      // Built-in fallback: ChatGPT {"v":"…"} + Claude content_block_delta
      try {
        var d = JSON.parse(line);
        if (!d) return null;
        if (typeof d.v === 'string') return d.v;
        if (d.type === 'content_block_delta' && d.delta &&
            typeof d.delta.text === 'string') return d.delta.text;
      } catch(_) {}
      return null;
    }
  };

  window.__autoAI = ai;

  window.fetch = async function() {
    var resp = await _origFetch.apply(this, arguments);
    if (ai._armed && ai._pattern) {
      var input = arguments[0];
      var url   = typeof input === 'string' ? input
                : (input instanceof Request ? input.url : '');
      if (url && ai._pattern.test(url) && resp.body) {
          ai._armed = false;  // disarm: capture only once per arm() call
          var teed       = resp.body.tee();
          var ourStream  = teed[0];
          var pageStream = teed[1];
          // Consume our copy without blocking the caller
          (function() {
            var reader      = ourStream.getReader();
            var decoder     = new TextDecoder();
            var accumulated = '';
            var lineBuffer  = '';
            function readNext() {
              reader.read().then(function(c) {
                if (c.done) { ai._finish(accumulated, false); return; }
                lineBuffer += decoder.decode(c.value, { stream: true });
                var parts = lineBuffer.split('\\n');
                lineBuffer = parts.pop() || '';
                for (var i = 0; i < parts.length; i++) {
                  var ln = parts[i].trim();
                  if (!ln.startsWith('data: ')) continue;
                  var e = ai._extract(ln.slice(6));
                  if (e !== null) accumulated += e;
                }
                readNext();
              }).catch(function() { ai._finish(accumulated, false); });
            }
            readNext();
          })();
          // Return page's stream copy so the AI site works normally
          try {
            return new Response(pageStream, {
              status: resp.status, statusText: resp.statusText, headers: resp.headers,
            });
          } catch(e) { return resp; }
      }
    }
    return resp;
  };
})()`
}

// ─── Phase 2: Arm ─────────────────────────────────────────────────────────────

/**
 * Arms the already-installed window.__autoAI wrapper for the next SSE request.
 *
 * Returns null immediately (synchronous) when ssePattern is empty — callers
 * should fall back to the DOM watcher.
 *
 * Returns null (asynchronously, after executeJavaScript resolves) when the
 * bootstrap was never installed — indicates a CDP failure; callers fall back.
 *
 * Otherwise returns a Promise<WatchResult> that resolves when the SSE stream
 * ends (or times out).
 *
 * MUST be called before inject() so the wrapper is armed before the AI site's
 * JS fires the SSE request in response to the injected click.
 */
export function interceptReply(
  view: WebContentsView,
  ssePattern: string | undefined,
  sseDataExtractor: string | undefined,
  logLabel?: string,
): Promise<WatchResult | null> {
  if (!ssePattern) return Promise.resolve(null)

  const label = logLabel ?? `wc-${view.webContents.id}`
  const bootstrapSrc = buildBootstrapScript()
  const patternJson   = JSON.stringify(ssePattern)
  const extractorJson = JSON.stringify(sseDataExtractor ?? 'return null;')
  const armScript     = `window.__autoAI ? window.__autoAI.arm(${patternJson}, ${extractorJson}, 119000) : null`

  log.info('network-interceptor: arming fetch interceptor + CDP Network tap', { ssePattern, label })

  const tap = startSseDebuggerTap(
    view.webContents,
    label,
    ssePattern,
    sseDataExtractor,
    PROCESS_TIMEOUT_MS - 1000,
  )

  const fetchChain = (async (): Promise<WatchResult> => {
    try {
      const hasBootstrap = await view.webContents.executeJavaScript('!!window.__autoAI') as boolean
      if (!hasBootstrap) {
        await view.webContents.executeJavaScript(bootstrapSrc)
        const afterInject = await view.webContents.executeJavaScript('!!window.__autoAI') as boolean
        if (!afterInject) {
          log.warn('network-interceptor: bootstrap missing after reinject')
          return { text: '', timedOut: true, _interceptReason: 'bootstrap-missing' }
        }
        log.info('network-interceptor: bootstrap reinjected before arm')
      }
    } catch (err) {
      log.warn('network-interceptor: bootstrap readiness check failed', { err: String(err) })
    }
    const r = (await view.webContents.executeJavaScript(armScript)) as WatchResult | null
    if (!r) {
      log.warn('network-interceptor: bootstrap not installed — CDP tap may still succeed')
      return { text: '', timedOut: true, _interceptReason: 'bootstrap-missing' }
    }
    log.info('network-interceptor: fetch-wrapper arm settled', {
      length: r.text?.length ?? 0,
      timedOut: r.timedOut,
    })
    return r
  })().catch((err) => {
    log.warn('network-interceptor: arm failed', { err: String(err) })
    return { text: '', timedOut: true, _interceptReason: 'arm-failed' } as WatchResult
  })

  const merged = mergeFetchAndCdp(fetchChain, tap.promise)

  return new Promise<WatchResult>((resolve) => {
    const timer = setTimeout(() => {
      log.warn('network-interceptor: main-process timeout after 120s')
      resolve({ text: '', timedOut: true, _interceptReason: 'main-timeout' })
    }, PROCESS_TIMEOUT_MS)

    merged
      .then((r) => {
        clearTimeout(timer)
        resolve(r)
      })
      .catch(() => {
        clearTimeout(timer)
        resolve({ text: '', timedOut: true, _interceptReason: 'arm-failed' })
      })
  }).finally(() => {
    tap.dispose()
  })
}
