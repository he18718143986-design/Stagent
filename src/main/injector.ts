/* ------------------------------------------------------------------ */
/*  src/main/injector.ts — Text injection + send-button click engine  */
/*                                                                      */
/*  Three injection strategies (tried in order):                       */
/*    1. React internal setter (nativeInputValueSetter)                */
/*    2. Clipboard paste simulation (for contenteditable rich text)    */
/*    3. Direct value assignment + input/change events (plain forms)   */
/* ------------------------------------------------------------------ */

import log from 'electron-log'
import type { WebContentsView } from 'electron'
import type { SelectorChain } from './site-store'

// ─── Injection script factory ─────────────────────────────────────────────────

function buildInjectScript(selector: string, text: string): string {
  // Escape the text to be safely embedded in a JS string literal
  const escaped = JSON.stringify(text)
  return `
(async function inject(selector, text) {
  const el = document.querySelector(selector);
  if (!el) return { ok: false, reason: 'element not found: ' + selector };

  // Do NOT gate on getBoundingClientRect: contenteditable inputs (e.g. ChatGPT
  // #prompt-textarea) report height=0 when empty, but injection still works.
  // Only reject elements that are explicitly invisible via computed style.
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return { ok: false, reason: 'element not visible' };
  }

  el.focus();
  await new Promise(r => setTimeout(r, 80)); // let focus settle

  // ── Strategy 1: React internal setter ──────────────────────────────────
  try {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value')
               || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
               || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    if (desc && desc.set) {
      desc.set.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      // Verify the value was accepted
      if (el.value === text || el.innerText === text || el.textContent === text) {
        return { ok: true, strategy: 'react-setter' };
      }
    }
  } catch (_) { /* not a value-based input, continue */ }

  // ── Strategy 2: Clipboard paste (contenteditable rich text) ────────────
  if (el.contentEditable === 'true') {
    try {
      // Select all existing content then replace via execCommand
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);

      // Try execCommand first (works in many SPAs)
      const inserted = document.execCommand('insertText', false, text);
      if (inserted && (el.innerText.trim() || el.textContent.trim())) {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, cancelable: true, data: text, inputType: 'insertText' }));
        el.dispatchEvent(new Event('input',  { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        return { ok: true, strategy: 'execCommand' };
      }

      // Fallback: clipboard writeText + paste event
      await navigator.clipboard.writeText(text).catch(() => {});
      el.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer(),
      }));
      await new Promise(r => setTimeout(r, 100));
      if (el.innerText.trim() || el.textContent.trim()) {
        return { ok: true, strategy: 'paste-event' };
      }

      // Last resort: manually set innerText
      el.innerText = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
      return { ok: true, strategy: 'innerText-set' };
    } catch (e) {
      return { ok: false, reason: 'contenteditable inject failed: ' + String(e) };
    }
  }

  // ── Strategy 3: Direct assignment (plain textarea / input) ─────────────
  try {
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, strategy: 'direct-assign' };
  } catch (e) {
    return { ok: false, reason: 'direct assign failed: ' + String(e) };
  }
})(${JSON.stringify(selector)}, ${escaped})
`
}

function buildClickScript(selector: string): string {
  return `
(function clickSend(selector) {
  const el = document.querySelector(selector);
  if (!el) return { ok: false, reason: 'send button not found: ' + selector };
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return { ok: false, reason: 'send button not visible' };
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
    return { ok: false, reason: 'button is disabled — React did not register input' };
  }
  el.click();
  return { ok: true };
})(${JSON.stringify(selector)})
`
}

function buildEnterScript(selector: string): string {
  return `
(function pressEnter(selector) {
  const el = document.querySelector(selector);
  if (!el) return { ok: false, reason: 'element not found for Enter: ' + selector };
  // Dispatch Enter on the element; for contenteditable divs (e.g. ChatGPT) Enter submits
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, composed: true }));
  el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true, composed: true }));
  el.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', bubbles: true, composed: true }));
  return { ok: true };
})(${JSON.stringify(selector)})
`
}

// ─── Selector chain resolver ─────────────────────────────────────────────────

interface ScriptResult {
  ok: boolean
  reason?: string
  strategy?: string
}

/**
 * Tries each selector in the chain (highest priority first) until one works.
 * Returns the winning selector string, or null if all failed.
 */
async function tryChain(
  view: WebContentsView,
  chain: SelectorChain,
  scriptFn: (selector: string) => string,
  label: string,
): Promise<string | null> {
  const sorted = [...chain].sort((a, b) => b.priority - a.priority)
  for (const entry of sorted) {
    try {
      const result = await view.webContents.executeJavaScript(
        scriptFn(entry.selector),
        true,
      ) as ScriptResult
      if (result?.ok) {
        log.debug(`injector: ${label} succeeded`, { selector: entry.selector, strategy: result.strategy })
        return entry.selector
      }
      log.debug(`injector: ${label} failed`, { selector: entry.selector, reason: result?.reason })
    } catch (err) {
      log.debug(`injector: ${label} exception`, { selector: entry.selector, err: String(err) })
    }
  }
  return null
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface InjectResult {
  ok: boolean
  reason?: string
  usedInputSelector?: string
  usedSendSelector?: string
}

/**
 * Injects text into the input field and clicks the send button.
 *
 * @param view            Target WebContentsView (the AI website)
 * @param text            Message text to inject
 * @param inputSelectors  Ordered fallback chain for the input element
 * @param sendSelectors   Ordered fallback chain for the send button
 */
export async function inject(
  view: WebContentsView,
  text: string,
  inputSelectors: SelectorChain,
  sendSelectors: SelectorChain,
): Promise<InjectResult> {
  // ── Step 1: Inject text ────────────────────────────────────────────────
  const usedInput = await tryChain(view, inputSelectors, (sel) => buildInjectScript(sel, text), 'inject')
  if (!usedInput) {
    return { ok: false, reason: 'Could not inject text — no input selector matched' }
  }

  // Wait for React to process the input event and enable the send button
  await delay(600)

  // ── Step 2: Click send button ──────────────────────────────────────────
  const usedSend = await tryChain(view, sendSelectors, buildClickScript, 'click-send')

  if (!usedSend) {
    // Final fallback: press Enter in the input field
    log.info('injector: send button not found, trying Enter keypress')
    await view.webContents.executeJavaScript(buildEnterScript(usedInput), true).catch(() => {})
    return { ok: true, usedInputSelector: usedInput, reason: 'Enter fallback used' }
  }

  return { ok: true, usedInputSelector: usedInput, usedSendSelector: usedSend }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
