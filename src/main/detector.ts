/* ------------------------------------------------------------------ */
/*  src/main/detector.ts — Heuristic selector auto-detection engine   */
/*                                                                      */
/*  Runs inside the target AI site's WebContentsView via               */
/*  executeJavaScript. Returns a detected SelectorStrategy or null.    */
/*  Results are appended (priority 3) to the SelectorChain; they do   */
/*  NOT replace existing entries and cannot overwrite calibrated sites. */
/* ------------------------------------------------------------------ */

import log from 'electron-log'
import type { WebContentsView } from 'electron'
import type { SelectorStrategy, SelectorChain, SelectorFields } from './site-store'
import { SiteStore } from './site-store'

// ─── Candidate selectors (ordered by semantic reliability) ────────────────────

/** Input box candidates — tried in order until a visible element is found. */
const INPUT_CANDIDATES: string[] = [
  '[role="textbox"]',
  'div[contenteditable="true"][data-placeholder]',
  'div[contenteditable="true"]',
  'textarea:not([readonly]):not([disabled])',
]

/** Send button candidates — searched relative to the input element. */
const SEND_CANDIDATES: string[] = [
  'button[type="submit"]',
  'button[aria-label*="send" i]',
  'button[aria-label*="发送" i]',
  'button[title*="send" i]',
  'button[title*="发送" i]',
  'button[data-testid*="send" i]',
]

/** Response container candidates — semantic attributes preferred. */
const RESPONSE_CANDIDATES: string[] = [
  '[data-message-author-role="assistant"]',
  '[class*="markdown"][class*="message"]',
  '.model-response-text',
  '.ds-markdown',
  '[class*="response-container"] [class*="markdown"]',
  '.prose',
]

// ─── In-page detection script (injected via executeJavaScript) ────────────────

/**
 * Returns the JS expression that detects input / send / response elements.
 * Runs entirely in the renderer context of the target website.
 */
function buildDetectionScript(): string {
  return `
(function detect() {
  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !el.disabled;
  }

  // ── Find input ───────────────────────────────────────────────────────────
  const inputCandidates = ${JSON.stringify(INPUT_CANDIDATES)};
  let inputSelector = null;
  for (const sel of inputCandidates) {
    const el = document.querySelector(sel);
    if (isVisible(el)) { inputSelector = sel; break; }
  }

  // ── Find send button ─────────────────────────────────────────────────────
  const sendCandidates = ${JSON.stringify(SEND_CANDIDATES)};
  let sendSelector = null;
  for (const sel of sendCandidates) {
    const el = document.querySelector(sel);
    if (isVisible(el)) { sendSelector = sel; break; }
  }

  // Fallback: last visible button in the form / near input
  if (!sendSelector && inputSelector) {
    const input = document.querySelector(inputSelector);
    const form = input && (input.closest('form') || input.closest('[role="main"]'));
    if (form) {
      const buttons = Array.from(form.querySelectorAll('button'));
      const visible = buttons.filter(b => isVisible(b));
      if (visible.length > 0) {
        // try to build a distinguishing selector for the last visible button
        const btn = visible[visible.length - 1];
        sendSelector = btn.id ? '#' + btn.id :
                       btn.getAttribute('data-testid') ? '[data-testid="' + btn.getAttribute('data-testid') + '"]' :
                       null;
      }
    }
  }

  // ── Find response container ───────────────────────────────────────────────
  const responseCandidates = ${JSON.stringify(RESPONSE_CANDIDATES)};
  let responseSelector = null;
  for (const sel of responseCandidates) {
    const el = document.querySelector(sel);
    if (el) { responseSelector = sel; break; }
  }

  return { inputSelector, sendSelector, responseSelector };
})()
`
}

// ─── Detector ─────────────────────────────────────────────────────────────────

export interface DetectionResult {
  inputSelector: string | null
  sendSelector: string | null
  responseSelector: string | null
}

/**
 * Runs the detection script in the given WebContentsView.
 * Returns raw detection result (null values = not found).
 */
export async function detectSelectors(view: WebContentsView): Promise<DetectionResult> {
  try {
    const result = await view.webContents.executeJavaScript(buildDetectionScript(), true)
    return result as DetectionResult
  } catch (err) {
    log.warn('detector: executeJavaScript failed', { err: String(err) })
    return { inputSelector: null, sendSelector: null, responseSelector: null }
  }
}

/**
 * Detects selectors and saves results to the SiteStore (priority 3).
 * Respects calibration protection: if site is calibrated, skips writing
 * inputSelectors / sendSelectors / responseSelectors.
 *
 * @returns true if at least one selector was found
 */
export async function detectAndSave(
  siteId: string,
  view: WebContentsView,
  store: SiteStore,
): Promise<boolean> {
  const config = store.get(siteId)
  if (!config) return false

  // If already calibrated and has all three chains, skip detection
  if (config.calibrated && hasAllChains(config)) {
    log.info('detector: skipping (calibrated + complete)', { siteId })
    return true
  }

  const detected = await detectSelectors(view)
  log.info('detector: raw result', { siteId, detected })

  const fields: SelectorFields = {}
  let found = false

  if (detected.inputSelector) {
    fields.inputSelectors = buildChain(detected.inputSelector, config.inputSelectors)
    found = true
  }
  if (detected.sendSelector) {
    fields.sendSelectors = buildChain(detected.sendSelector, config.sendSelectors)
    found = true
  }
  if (detected.responseSelector) {
    fields.responseSelectors = buildChain(detected.responseSelector, config.responseSelectors)
    found = true
  }

  if (Object.keys(fields).length > 0) {
    // source='detector' respects calibration protection inside SiteStore
    store.updateSelectors(siteId, fields, 'detector')
  }

  return found
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hasAllChains(config: ReturnType<SiteStore['get']> & object): boolean {
  return (
    config.inputSelectors.length > 0 &&
    config.sendSelectors.length > 0 &&
    config.responseSelectors.length > 0
  )
}

/**
 * Merges a newly detected selector into an existing chain at priority 3.
 * If the selector already exists in the chain, updates its entry instead
 * of duplicating it.
 */
function buildChain(selector: string, existing: SelectorChain): SelectorChain {
  const detected: SelectorStrategy = {
    selector,
    method: 'css',
    priority: 3,
    failCount: 0,
  }

  const without = existing.filter((s) => s.selector !== selector)
  // Re-insert and sort descending by priority
  return [...without, detected].sort((a, b) => b.priority - a.priority)
}
