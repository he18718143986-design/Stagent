/* ------------------------------------------------------------------ */
/*  src/main/automation/model-switch.ts                                */
/*  M13: shared model-switch page action.                              */
/*                                                                      */
/*  Extracted from the chat:switch-model IPC so both the interactive   */
/*  path (ipc.ts) and task execution (local-adapter) drive the same    */
/*  logic: open the model picker, then click the target option by      */
/*  selector or visible text. This module performs ONLY the page       */
/*  action — persistence (store.setActiveModel) stays with the caller. */
/* ------------------------------------------------------------------ */

import type { WebContents } from 'electron'
import log from 'electron-log'
import type { SiteConfig } from '../site-store'

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface ModelSwitchResult {
  ok: boolean
  /** The label of the model that was selected (on success). */
  modelLabel?: string
  reason?: string
}

/**
 * Switch the AI site to `modelId` on the live page.
 * @returns ok + modelLabel on success, otherwise a reason code.
 */
export async function applyModelSwitch(
  webContents: WebContents,
  config: SiteConfig,
  modelId: string,
): Promise<ModelSwitchResult> {
  if (!config.modelSwitcherSelector) return { ok: false, reason: 'model-switching-not-supported' }
  if (!config.availableModels?.length) return { ok: false, reason: 'no-models-configured' }

  const model = config.availableModels.find((m) => m.id === modelId)
  if (!model) return { ok: false, reason: 'model-not-found' }

  try {
    // Step 1: open the model picker dropdown.
    const openResult = (await webContents.executeJavaScript(`
      (function() {
        var el = document.querySelector(${JSON.stringify(config.modelSwitcherSelector)});
        if (!el) return { ok: false, reason: 'switcher-not-found' };
        el.click();
        return { ok: true };
      })()
    `)) as { ok: boolean; reason?: string }
    if (!openResult.ok) {
      return { ok: false, reason: openResult.reason ?? 'switcher-not-found' }
    }

    // Step 2: let the dropdown render.
    await delay(400)

    // Step 3: click the target option (specific selector first, then text match).
    const modelSelector = model.selector ?? ''
    const clickResult = (await webContents.executeJavaScript(`
      (function() {
        var label = ${JSON.stringify(model.label)};
        if (${JSON.stringify(modelSelector)}) {
          var bySelector = document.querySelector(${JSON.stringify(modelSelector)});
          if (bySelector) { bySelector.click(); return { ok: true, strategy: 'selector' }; }
        }
        var candidates = document.querySelectorAll(
          '[role="option"], [role="menuitem"], [role="menuitemradio"], [role="listitem"], li, button'
        );
        for (var i = 0; i < candidates.length; i++) {
          var txt = (candidates[i].innerText || candidates[i].textContent || '').trim();
          if (txt === label || txt.indexOf(label) > -1) {
            candidates[i].click();
            return { ok: true, strategy: 'text-match' };
          }
        }
        return { ok: false, reason: 'model-option-not-found' };
      })()
    `)) as { ok: boolean; strategy?: string; reason?: string }
    if (!clickResult.ok) {
      return { ok: false, reason: clickResult.reason ?? 'model-option-not-found' }
    }

    log.info('model-switch: ok', { siteId: config.siteId, modelId, strategy: clickResult.strategy })
    return { ok: true, modelLabel: model.label }
  } catch (err) {
    log.warn('model-switch: failed', { siteId: config.siteId, modelId, err: String(err) })
    return { ok: false, reason: String(err) }
  }
}

export interface EffortSwitchResult {
  ok: boolean
  /** The label of the effort tier that was selected (on success). */
  effortLabel?: string
  reason?: string
}

/** Page-side helper: click the first element whose visible text contains `needle`. */
function buildClickByTextScript(needle: string, selector?: string): string {
  return `(function(){
    var sel = ${JSON.stringify(selector ?? '')};
    var needle = ${JSON.stringify(needle)};
    if (sel) {
      var bySel = null;
      try { bySel = document.querySelector(sel); } catch(e) { bySel = null; }
      if (bySel) { bySel.click(); return { ok: true, strategy: 'selector' }; }
    }
    var nodes = document.querySelectorAll(
      '[role="option"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="listitem"], li, button'
    );
    for (var i = 0; i < nodes.length; i++) {
      var txt = (nodes[i].innerText || nodes[i].textContent || '').trim();
      if (txt === needle || txt.indexOf(needle) > -1) { nodes[i].click(); return { ok: true, strategy: 'text-match' }; }
    }
    return { ok: false, reason: 'option-not-found' };
  })()`
}

/**
 * Set the reasoning-effort tier (e.g. Claude Effort High) on the live page.
 *
 * The tier usually lives inside the model picker, so this:
 *   1. opens `modelSwitcherSelector` (required — that's where the tier lives),
 *   2. optionally opens the "Effort" submenu (`effortMenuTriggerSelector`),
 *   3. clicks the tier by its selector or visible text.
 */
export async function applyEffort(
  webContents: WebContents,
  config: SiteConfig,
  effortId: string,
): Promise<EffortSwitchResult> {
  if (!config.effortLevels?.length) return { ok: false, reason: 'effort-not-supported' }
  if (!config.modelSwitcherSelector) return { ok: false, reason: 'no-effort-trigger' }

  const level = config.effortLevels.find((e) => e.id === effortId)
  if (!level) return { ok: false, reason: 'effort-not-found' }

  try {
    // Step 1: open the model picker (the effort tiers live inside it).
    const opened = (await webContents.executeJavaScript(
      `(function(){var el=document.querySelector(${JSON.stringify(config.modelSwitcherSelector)});if(!el)return false;el.click();return true;})()`,
    )) as boolean
    if (!opened) return { ok: false, reason: 'switcher-not-found' }
    await delay(400)

    // Step 2: open the "Effort" submenu if one is configured.
    if (config.effortMenuTriggerSelector) {
      const sub = config.effortMenuTriggerSelector
      const needle = sub.indexOf('text=') === 0 ? sub.slice(5) : sub
      const subSel = sub.indexOf('text=') === 0 ? undefined : sub
      const subOpened = (await webContents.executeJavaScript(
        buildClickByTextScript(needle, subSel),
      )) as { ok: boolean; reason?: string }
      if (!subOpened.ok) return { ok: false, reason: subOpened.reason ?? 'effort-submenu-not-found' }
      await delay(300)
    }

    // Step 3: click the target tier.
    const levelSel = level.selector ?? ''
    const needle = levelSel.indexOf('text=') === 0 ? levelSel.slice(5) : level.label
    const querySel = levelSel && levelSel.indexOf('text=') !== 0 ? levelSel : undefined
    const clicked = (await webContents.executeJavaScript(
      buildClickByTextScript(needle, querySel),
    )) as { ok: boolean; strategy?: string; reason?: string }
    if (!clicked.ok) return { ok: false, reason: clicked.reason ?? 'effort-option-not-found' }

    log.info('effort-switch: ok', { siteId: config.siteId, effortId, strategy: clicked.strategy })
    return { ok: true, effortLabel: level.label }
  } catch (err) {
    log.warn('effort-switch: failed', { siteId: config.siteId, effortId, err: String(err) })
    return { ok: false, reason: String(err) }
  }
}
