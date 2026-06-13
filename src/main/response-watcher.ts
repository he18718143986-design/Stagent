/* ------------------------------------------------------------------ */
/*  src/main/response-watcher.ts — DOM stability watcher (M4)         */
/*                                                                      */
/*  Algorithm (SPEC §2.3):                                             */
/*   1. Wait 800ms for generation to start.                            */
/*   2. Record adjustedBeforeCount = count of response elements.       */
/*   3. MutationObserver: on each change, reset 1500ms stable timer.  */
/*   4. Count drops (SPA re-render) → reset baseline, keep waiting.  */
/*   5. Stable 1500ms AND count > baseline → extract & return.        */
/*   6. Parallel: every 2s check quotaExhaustedIndicator.             */
/*   7. Hard 120s timeout.                                             */
/* ------------------------------------------------------------------ */

import log from 'electron-log'
import type { WebContentsView } from 'electron'
import type { SelectorChain, OutputType } from './site-store'

// ─── Public result type ───────────────────────────────────────────────────────

export interface WatchResult {
  quotaExhausted?: boolean
  text?: string
  imageUrls?: string[]
  videoUrl?: string
  timedOut?: boolean
  /** Diagnostic: selector → element count at timeout (for debugging only) */
  _selectorCounts?: Array<{ sel: string; count: number }>
  /** Diagnostic: network-interceptor invalid reason (if any). */
  _interceptReason?: 'bootstrap-missing' | 'arm-failed' | 'main-timeout'
}

function debugTextPreview(text: string): { preview: string; codepoints: string[] } {
  const chars = Array.from(text).slice(0, 40)
  return {
    preview: chars.join(''),
    codepoints: chars.map((ch) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`),
  }
}

// ─── Main API ─────────────────────────────────────────────────────────────────

/**
 * Injects a MutationObserver script into the given WebContentsView and
 * waits for the AI response to finish generating.
 */
export async function watchForReply(
  view: WebContentsView,
  responseSelectors: SelectorChain,
  outputType: OutputType,
  quotaExhaustedIndicator?: string,
): Promise<WatchResult> {
  const selectors = sortedSelectors(responseSelectors)
  if (!selectors.length) {
    log.warn('response-watcher: no responseSelectors in chain — returning empty')
    return { text: '' }
  }

  const indicator = quotaExhaustedIndicator ?? ''
  const script = buildObserverScript(selectors, outputType, indicator)

  log.info('response-watcher: watching', { selectors, outputType, hasQuotaIndicator: indicator.length > 0 })

  try {
    // Race the injected observer against a hard main-process timeout
    const result = await Promise.race([
      view.webContents.executeJavaScript(script) as Promise<WatchResult>,
      new Promise<WatchResult>((resolve) =>
        setTimeout(() => resolve({ timedOut: true, text: '' }), 125_000),
      ),
    ])

    if (result.timedOut) {
      log.warn('response-watcher: timed out', {
        selectors,
        selectorCounts: result._selectorCounts ?? [],
      })
    } else if (result.quotaExhausted) {
      log.info('response-watcher: quota exhausted detected')
    } else {
      const dbg = debugTextPreview(result.text ?? '')
      log.info('response-watcher: reply captured', {
        selectors,
        textLen: result.text?.length ?? 0,
        imageCount: result.imageUrls?.length ?? 0,
        textPreview: dbg.preview,
        textCodepoints: dbg.codepoints,
      })
    }

    return result
  } catch (err) {
    log.error('response-watcher: executeJavaScript threw', { err: String(err) })
    return { text: '' }
  }
}

// ─── Author-label filter (also exported for unit tests) ─────────────────────

/**
 * Returns true when `text` looks like an AI author-header label
 * (e.g. "ChatGPT说：", "Assistant:") with no additional body content.
 *
 * Used inside the injected IIFE (mirrored as a JS function) to skip broad
 * container selectors that only contain a role label before the model has
 * written any reply text.
 *
 * Rules (conservative — only reject clearly label-only strings):
 *   • trimmed length ≤ 20
 *   • matches one of the known role-name patterns (ChatGPT, Assistant, Claude,
 *     Gemini, Kimi, DeepSeek, Copilot) optionally followed by ":" / "说："
 */
export function isLikelyAuthorLabel(text: string): boolean {
  // Normalize: strip a broader set of invisible/control separators that can
  // appear in streamed DOM text (e.g. \u2060 WORD JOINER), then collapse spaces.
  const t = text
    .replace(/[\u200b\u200c\u200d\u200e\u200f\u202a-\u202e\u2060\u00ad\u00a0\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // Length cap 30 (not 20) to tolerate invisible chars that inflate raw length
  // before normalization.
  if (t.length === 0) return false
  // Build a compact variant with all spaces removed. Some pages render labels
  // with fragmented whitespace ("C h a t G P T 说："), which would bypass simple
  // regexes on the normalized string.
  const compact = t.replace(/\s+/g, '').toLowerCase()
  // Defensive prefix guard: some pages inject tiny variants like
  // "chatgpt说：" with extra hidden separators that can bypass exact regexes.
  // For short strings that start with a known assistant name, treat as label.
  if (
    compact.length <= 12
    && !/[。！？.!?]/.test(t)
    && (
      compact.startsWith('chatgpt')
      || compact.startsWith('assistant')
      || compact.startsWith('claude')
      || compact.startsWith('gemini')
      || compact.startsWith('kimi')
      || compact.startsWith('deepseek')
      || compact.startsWith('copilot')
    )
  ) {
    return true
  }
  // Suffix pattern: optional 说/説/說 + optional colon (: or ：),
  // or just an optional colon on its own.
  return (
    /^chatgpt(说|説|說)?[：:]?$/.test(compact) ||
    /^assistant(说|説|說)?[：:]?$/.test(compact) ||
    /^claude(说|説|說)?[：:]?$/.test(compact) ||
    /^gemini(说|説|說)?[：:]?$/.test(compact) ||
    /^kimi(说|説|說)?[：:]?$/.test(compact) ||
    /^deepseek(说|説|說)?[：:]?$/.test(compact) ||
    /^copilot(说|説|說)?[：:]?$/.test(compact)
  )
}

/**
 * Returns true when a WatchResult already has usable content that the
 * MutationObserver IIFE should resolve with immediately (late-start guard).
 *
 * Exported for unit-testing without an Electron harness.
 *
 * Regression: before the late-start fix, watchForReply() could time out even
 * when the AI had already finished — because the IIFE checked for mutations
 * from a fresh baseline rather than inspecting pre-existing DOM content.
 */
export function hasExtractableContent(
  result: WatchResult,
  outputType: OutputType,
): boolean {
  if (outputType === 'image') return Array.isArray(result.imageUrls) && result.imageUrls.length > 0
  if (typeof result.text !== 'string') return false
  const text = result.text.trim()
  if (!text) return false
  return !isLikelyAuthorLabel(text)
}

/**
 * Returns true when onStable() should call finish() with this result.
 *
 * The new onStable() logic: always try extractBestResult() first; if valid
 * content is found (text non-empty, or imageUrls non-empty), finish immediately
 * regardless of whether hasNewContent() reports a baseline change.
 *
 * Exported for unit-testing without an Electron harness.
 *
 * Regression: before this fix, onStable() started with
 *   `if (!hasNewContent(baselines)) return;`
 * which meant that if content existed when the observer initialised (late-start
 * scenario, or AI already finished), the watcher would time out at 120 s even
 * though extractBestResult() would have returned valid text immediately.
 */
export function onStableShouldFinish(
  result: WatchResult,
  outputType: OutputType,
): boolean {
  return hasExtractableContent(result, outputType)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns all selector strings from the chain, sorted highest-priority first. */
function sortedSelectors(chain: SelectorChain): string[] {
  if (!chain.length) return []
  return [...chain].sort((a, b) => b.priority - a.priority).map((s) => s.selector)
}

// ─── Injected script builder ──────────────────────────────────────────────────

/**
 * Builds a self-contained JavaScript IIFE that returns a Promise<WatchResult>.
 *
 * Accepts ALL selectors from the chain (sorted by priority).  ALL selectors
 * are monitored in parallel: the observer resolves as soon as ANY selector
 * shows a count increase or a text change from the baseline snapshot taken
 * after the initial 800 ms wait.  This prevents a miscalibrated selector
 * (e.g. a static <p> or SVG that never changes) from blocking detection of
 * the actual response element matched by another selector in the chain.
 */
function buildObserverScript(
  selectors: string[],
  outputType: OutputType,
  quotaIndicator: string,
): string {
  // Safely embed values via JSON serialisation — no injection risk.
  // QUOTA_INDICATORS is an array of individual candidate strings split from
  // the '||'-delimited quotaExhaustedIndicator preset field.
  const selsJson = JSON.stringify(selectors)
  const quotaIndicators = quotaIndicator
    ? quotaIndicator.split('||').map((s) => s.trim()).filter(Boolean)
    : []
  const quotaStr = JSON.stringify(quotaIndicators)
  const typeStr = JSON.stringify(outputType)

  return `
(async function () {
  var SELECTORS = ${selsJson};
  var QUOTA_INDICATORS = ${quotaStr};
  var OUTPUT_TYPE = ${typeStr};
  var STABLE_MS = 1500;
  var INIT_WAIT_MS = 800;
  var TIMEOUT_MS = 119200; // 120 000 - 800 ms init wait

  // Returns the visible text of an element, excluding <script>, <style> and
  // <noscript> nodes.  document.body.textContent includes JS source code from
  // inline <script> tags — which causes ChatGPT's SSR telemetry script to be
  // mistaken for AI response text.  Cloning + removing those nodes first gives
  // clean, human-readable text.
  function getBodyText() {
    if (!document.body) return '';
    try {
      var clone = document.body.cloneNode(true);
      var junk = clone.querySelectorAll('script, style, noscript, head');
      for (var j = 0; j < junk.length; j++) {
        if (junk[j].parentNode) junk[j].parentNode.removeChild(junk[j]);
      }
      return (clone.textContent || '').trim();
    } catch(e) {
      return '';
    }
  }

  // Returns the text of a specific element with script/style/noscript stripped.
  // ChatGPT injects SSR telemetry <script> tags INSIDE conversation-turn elements,
  // so reading textContent without stripping returns JavaScript source code instead
  // of the AI's reply.  innerText avoids this but is unreliable when elements are
  // off-screen or not yet laid out (returns '' for un-rendered streaming content).
  function getElementText(el) {
    if (!el) return '';
    try {
      // Fast path: innerText only returns visible text (no script content).
      // Only use it when it actually has content, because an element being
      // streamed into may momentarily have innerText='' before the first chunk.
      var it = (el.innerText || '').trim();
      if (it) return it;
      // Fallback: clone + strip unsafe nodes, then read textContent.
      var clone = el.cloneNode(true);
      var junk = clone.querySelectorAll('script, style, noscript');
      for (var j = 0; j < junk.length; j++) {
        if (junk[j].parentNode) junk[j].parentNode.removeChild(junk[j]);
      }
      return (clone.textContent || '').trim();
    } catch(e) {
      return '';
    }
  }

  // Build per-selector baselines (count + last-element text) after init wait.
  // Called once; used to detect incremental changes on any selector.
  // Also records body text length as a last-resort growth detector in case all
  // configured selectors fail to match the current page DOM structure.
  var baseBodyLen = 0;
  var baseBodyText = '';

  function buildBaselines() {
    baseBodyText = getBodyText();
    baseBodyLen = baseBodyText.length;
    return SELECTORS.map(function(sel) {
      try {
        var els = document.querySelectorAll(sel);
        var count = els.length;
        var lastText = count > 0 ? getElementText(els[els.length - 1]) : '';
        return { sel: sel, count: count, lastText: lastText };
      } catch(e) {
        return { sel: sel, count: 0, lastText: '' };
      }
    });
  }

  // Returns true if ANY selector's last element has text that differs from its
  // baseline.  Count changes are handled by the MutationObserver (below) which
  // re-baselines eagerly on every mutation — by the time onStable() fires the
  // baselines already reflect the most recent turn-structure snapshot, so here
  // we only need to compare TEXT.
  //
  // Body-growth (≥50 visible chars, script/style excluded) is a safety-net
  // fallback for sites where all configured selectors fail to match the DOM.
  function hasNewContent(baselines) {
    for (var i = 0; i < baselines.length; i++) {
      var b = baselines[i];
      try {
        var els = document.querySelectorAll(b.sel);
        if (els.length > 0) {
          var txt = getElementText(els[els.length - 1]);
          if (txt.length > 0 && txt !== b.lastText) return true;
        }
      } catch(e) {}
    }
    // Body-growth fallback: ≥50 new visible chars (script/style excluded).
    try {
      var bodyNow = getBodyText();
      if (bodyNow.length > baseBodyLen + 50) return true;
    } catch(e) {}
    return false;
  }

  // True only when page state indicates progress compared with the snapshot
  // taken right after send() and before INIT_WAIT_MS elapsed.
  function hasProgressSincePreSend(baselines, preSendSnap, preSendBodyLen) {
    for (var i = 0; i < baselines.length; i++) {
      var pre = preSendSnap[i];
      var cur = baselines[i];
      if (!pre || !cur) continue;
      if (cur.count > pre.n) return true;
      if (cur.lastText && cur.lastText !== pre.t && !isLikelyAuthorLabel(cur.lastText)) return true;
    }
    try {
      if (getBodyText().length > preSendBodyLen + 50) return true;
    } catch(e) {}
    return false;
  }

  // Returns the result from the FIRST (highest-priority) selector that has
  // non-empty content.  SELECTORS is already sorted highest-priority first by
  // sortedSelectors() in the host process.
  //
  // Using priority-first (not longest-text) avoids returning a broad container
  // element (e.g. [data-testid*="conversation-turn"] which includes the author
  // header "ChatGPT 说：") when a more specific inner selector (e.g.
  // div.markdown.prose which contains only the response text) is available.

  // Avoid accepting author-header containers as the final reply text.
  // When a broad selector (e.g. conversation-turn) is queried its last element
  // may contain only the role label ("ChatGPT说：", "Assistant:") before the
  // model has written any body text.  Returning that label would mark the reply
  // as "done" with empty / wrong content.  We skip such candidates and let
  // extractBestResult() continue to the next selector.
  function isLikelyAuthorLabel(text) {
    var t = text
      .replace(/[\u200b\u200c\u200d\u200e\u200f\u202a-\u202e\u2060\u00ad\u00a0\ufeff]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    var compact = t.replace(/\s+/g, '').toLowerCase();
    if (t.length === 0) return false;
    if (compact.length <= 12 &&
        !/[。！？.!?]/.test(t) &&
        (compact.indexOf('chatgpt') === 0 ||
         compact.indexOf('assistant') === 0 ||
         compact.indexOf('claude') === 0 ||
         compact.indexOf('gemini') === 0 ||
         compact.indexOf('kimi') === 0 ||
         compact.indexOf('deepseek') === 0 ||
         compact.indexOf('copilot') === 0)) return true;
    return /^chatgpt(说|説|說)?[：:]?$/.test(compact) ||
           /^assistant(说|説|說)?[：:]?$/.test(compact) ||
           /^claude(说|説|說)?[：:]?$/.test(compact) ||
           /^gemini(说|説|說)?[：:]?$/.test(compact) ||
           /^kimi(说|説|說)?[：:]?$/.test(compact) ||
           /^deepseek(说|説|說)?[：:]?$/.test(compact) ||
           /^copilot(说|説|說)?[：:]?$/.test(compact);
  }

  function extractBestResult() {
    for (var i = 0; i < SELECTORS.length; i++) {
      try {
        var els = document.querySelectorAll(SELECTORS[i]);
        if (!els.length) continue;
        var last = els[els.length - 1];
        if (OUTPUT_TYPE === 'image') {
          var imgs = Array.from(last.querySelectorAll('img'));
          if (imgs.length > 0) {
            return { imageUrls: imgs.map(function(img) { return img.src; }).filter(Boolean) };
          }
        } else {
          var txt = getElementText(last);
          // Skip author-label-only text (e.g. "ChatGPT说：") — these come from
          // broad container selectors before body text has been appended.
          if (txt.length > 0 && !isLikelyAuthorLabel(txt)) return { text: txt };
        }
      } catch(e) {}
    }
    if (OUTPUT_TYPE === 'image') return { imageUrls: [] };
    return { text: '' };
  }

  function checkQuota() {
    if (!QUOTA_INDICATORS.length) return false;
    var bodyText = null;
    for (var i = 0; i < QUOTA_INDICATORS.length; i++) {
      var q = QUOTA_INDICATORS[i];
      if (!q) continue;
      try {
        if (q.startsWith('text=')) {
          if (bodyText === null) bodyText = document.body.textContent || '';
          if (bodyText.toLowerCase().includes(q.slice(5).toLowerCase())) return true;
        } else {
          if (document.querySelector(q)) return true;
        }
      } catch(e) {}
    }
    return false;
  }

  // Pre-send snapshot: capture DOM state BEFORE the 800ms init wait so we can
  // detect fast responses that arrive *during* the wait (while MutationObserver
  // is not yet active).  If baselines differ from this snapshot after the wait,
  // the AI already finished and we must resolve immediately without waiting for
  // further mutations (which will never come).
  var preSendSnap = SELECTORS.map(function(sel) {
    try {
      var e = document.querySelectorAll(sel);
      return { n: e.length, t: e.length > 0 ? getElementText(e[e.length - 1]) : '' };
    } catch(_) { return { n: 0, t: '' }; }
  });
  var preSendBodyLen = getBodyText().length;

  // Step 1: wait for generation to begin
  await new Promise(function(r) { setTimeout(r, INIT_WAIT_MS); });

  return new Promise(function(resolve) {
    // Snapshot baselines for ALL selectors after the init wait.
    var baselines = buildBaselines();

    var stableTimer = null;
    var observer = null;
    var quotaInterval = null;
    var mainTimeout = null;
    var settled = false;

    function finish(result) {
      if (settled) return;
      settled = true;
      try { if (observer) observer.disconnect(); } catch(e) {}
      if (stableTimer) clearTimeout(stableTimer);
      if (quotaInterval) clearInterval(quotaInterval);
      if (mainTimeout) clearTimeout(mainTimeout);
      resolve(result);
    }

    // Called when DOM has been stable for STABLE_MS.
    // Priority-first: always attempt extractBestResult() immediately.  If valid
    // content is already present (text non-empty & not an author label, or
    // imageUrls non-empty) we finish() right away — even if no *new* change was
    // detected relative to the baseline.  This handles the "late-start watcher"
    // case where content existed before the observer began, and the "already
    // stable" case where the AI finished before the first stability window fired.
    // Only if extraction yields nothing do we fall back to the hasNewContent()
    // check (to allow the observer to keep waiting for incremental mutations).
    function onStable() {
      var result = extractBestResult();
      var hasContent = OUTPUT_TYPE === 'image'
        ? !!(result.imageUrls && result.imageUrls.length > 0)
        : !!(result.text && result.text.trim().length > 0 && !isLikelyAuthorLabel(result.text));
      var hasProgress = hasProgressSincePreSend(baselines, preSendSnap, preSendBodyLen);
      if (hasContent && hasProgress) { finish(result); return; }
      // No valid content yet — only keep the stability timer running if there
      // are new mutations relative to the baseline (content still arriving).
      // If hasNewContent is also false the page hasn't changed at all; we simply
      // let the hard 120 s timeout handle the final fallback.
      // (No action needed here — resetStable is called by the MutationObserver.)
    }

    function resetStable() {
      if (stableTimer) clearTimeout(stableTimer);
      stableTimer = setTimeout(onStable, STABLE_MS);
    }

    // Step 6: parallel quota detection
    if (QUOTA_INDICATORS.length) {
      quotaInterval = setInterval(function() {
        if (checkQuota()) finish({ quotaExhausted: true });
      }, 2000);
    }

    // Step 3–4: MutationObserver
    // On every DOM mutation, re-baseline any selector whose element COUNT has
    // changed (new turn inserted or SPA re-render).
    //
    // CRITICAL: The stability timer is reset ONLY when the RESPONSE TEXT itself
    // changes — NOT on every background DOM mutation.  Modern AI SPAs (ChatGPT,
    // Claude) fire continuous React-internal / analytics mutations long after
    // generation finishes.  Resetting the timer on those would prevent the
    // 1500 ms stability window from ever being reached and cause a 120 s timeout
    // even though the response is complete.
    //
    // lastResponseText tracks the last-seen response content.  null = initial
    // state (first mutation will always trigger resetStable via null !== '').
    var lastResponseText = null;
    observer = new MutationObserver(function() {
      var countChanged = false;
      for (var rb = 0; rb < baselines.length; rb++) {
        var bl = baselines[rb];
        try {
          var rbEls = document.querySelectorAll(bl.sel);
          if (rbEls.length !== bl.count) {
            bl.count = rbEls.length;
            bl.lastText = bl.count > 0 ? getElementText(rbEls[bl.count - 1]) : '';
            countChanged = true;
          }
        } catch(e) {}
      }
      // Extract current best response text/imageUrls for comparison.
      var curResult = extractBestResult();
      var curText = curResult.text !== undefined ? curResult.text
                  : curResult.imageUrls ? JSON.stringify(curResult.imageUrls) : '';
      if (curText !== lastResponseText || countChanged) {
        lastResponseText = curText;
        // Only reset the stability timer when extractBestResult() has actual
        // reply content.  If all selectors yield empty text (e.g. an overly-
        // specific calibration selector hasn't matched, or the only text found
        // was an author-label that was filtered), background / structural DOM
        // mutations must NOT perpetually reset the 1500 ms window — otherwise
        // the watcher times out at 120 s even when valid content is present in
        // a lower-priority selector.  Letting the timer expire allows onStable()
        // to fire and hasNewContent() to check each selector independently.
        var curHasContent = curText.trim().length > 0 ||
          !!(curResult.imageUrls && curResult.imageUrls.length > 0);
        if (curHasContent) resetStable();
      }
      // Background mutations that don't change response content → no stable
      // timer reset → 1500 ms can elapse → onStable() fires normally.
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Kick off stability timer (handles already-stable case immediately)
    resetStable();

    // Step 7: hard 120s timeout — return whatever text exists across all selectors
    // Also collect per-selector element counts for diagnostics.
    mainTimeout = setTimeout(function() {
      var base = extractBestResult();
      var counts = SELECTORS.map(function(sel) {
        try { return { sel: sel, count: document.querySelectorAll(sel).length }; }
        catch(e) { return { sel: sel, count: -1 }; }
      });
      finish(Object.assign({}, base, { timedOut: true, _selectorCounts: counts }));
    }, TIMEOUT_MS);

    // Fast-response detection: if the AI finished generating during the 800ms
    // init wait, MutationObserver never fired so hasNewContent(baselines) would
    // always return false (baselines already reflect the final DOM state).
    // Compare post-wait baselines to the pre-send snapshot; if anything grew,
    // the response is already complete — extract and resolve immediately.
    (function() {
      if (settled) return;
      for (var i = 0; i < preSendSnap.length; i++) {
        var pre = preSendSnap[i];
        var cur = baselines[i];
        // cur has fields {sel, count, lastText}; pre has {n, t}.
        // Before this fix: cur.n and cur.t were always undefined → branch never fired.
        if (cur.count > pre.n || (cur.lastText && cur.lastText !== pre.t)) {
          var fr = extractBestResult();
          var frHas = OUTPUT_TYPE === 'image'
            ? !!(fr.imageUrls && fr.imageUrls.length)
            : !!(fr.text && fr.text.trim() && !isLikelyAuthorLabel(fr.text));
          if (frHas) { finish(fr); return; }
        }
      }
      try {
        if (getBodyText().length > preSendBodyLen + 50) {
          var fr2 = extractBestResult();
          var fr2Has = OUTPUT_TYPE === 'image'
            ? !!(fr2.imageUrls && fr2.imageUrls.length)
            : !!(fr2.text && fr2.text.trim() && !isLikelyAuthorLabel(fr2.text));
          if (fr2Has) { finish(fr2); return; }
        }
      } catch(e) {}
    })();
  });
})()
`
}
