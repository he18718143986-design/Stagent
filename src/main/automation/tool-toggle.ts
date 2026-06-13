/* ------------------------------------------------------------------ */
/*  src/main/automation/tool-toggle.ts                                 */
/*  M12: Drive one-click composer tools (深度思考 / 联网搜索 …).        */
/*                                                                      */
/*  Shared by the chat:toggle-tool IPC (interactive) and the local      */
/*  adapter (ensure tools ON before a task-execution send). Mirrors the */
/*  model-switching approach in ipc.ts but for boolean tool toggles.    */
/* ------------------------------------------------------------------ */

import type { WebContents } from 'electron'
import log from 'electron-log'
import type { SiteConfig, ToolToggle } from '../site-store'

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface ToolToggleResult {
  ok: boolean
  /** Whether the control was actually clicked this call. */
  clicked: boolean
  /** Resolved on/off state after the action, or null when it can't be read. */
  state: boolean | null
  reason?: string
}

/**
 * Pure decision: given the control's current on/off state (null = unknown) and
 * the desired `enable` (undefined = pure toggle), decide whether to click.
 *
 *   • enable === undefined → always click (flip).
 *   • current unknown      → click only when enabling (we can't verify a
 *                            disable on a stateless menu item).
 *   • current known        → click only when it differs from desired.
 *
 * Exported for unit testing without a live page.
 */
export function decideToggleAction(
  currentState: boolean | null,
  enable?: boolean,
): 'click' | 'skip' {
  if (enable === undefined) return 'click'
  if (currentState === null) return enable ? 'click' : 'skip'
  return currentState !== enable ? 'click' : 'skip'
}

/** Page-side script: locate the tool control, read its state, click per decision. */
function buildToggleScript(tool: ToolToggle, enable?: boolean): string {
  const enableArg = enable === undefined ? 'null' : JSON.stringify(enable)
  return `(function(){
    var sel = ${JSON.stringify(tool.selector)};
    var label = ${JSON.stringify(tool.label)};
    var enable = ${enableArg};
    function findByText(t){
      if(!t) return null;
      var nodes = document.querySelectorAll('[role="button"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="switch"],button,li');
      for (var i=0;i<nodes.length;i++){
        var s=(nodes[i].innerText||nodes[i].textContent||'').trim();
        if (s===t || s.indexOf(t)>-1) return nodes[i];
      }
      return null;
    }
    var el = null;
    if (sel.indexOf('text=')===0){ el = findByText(sel.slice(5)); }
    else { try { el = document.querySelector(sel); } catch(e){ el=null; } }
    if (!el) el = findByText(label);
    if (!el) return { ok:false, clicked:false, state:null, reason:'tool-control-not-found' };
    function readState(node){
      var p = node.getAttribute && node.getAttribute('aria-pressed');
      if (p==='true') return true; if (p==='false') return false;
      var c = node.getAttribute && node.getAttribute('aria-checked');
      if (c==='true') return true; if (c==='false') return false;
      var cls = ((node.className||'')+'');
      if (/(\\bactive\\b|toggled|selected|--on|is-on|enabled)/i.test(cls)) return true;
      return null;
    }
    var state = readState(el);
    var shouldClick;
    if (enable===null){ shouldClick = true; }
    else if (state===null){ shouldClick = (enable===true); }
    else { shouldClick = (state !== enable); }
    if (!shouldClick) return { ok:true, clicked:false, state:state };
    try { el.click(); } catch(e){ return { ok:false, clicked:false, state:state, reason:'click-failed' }; }
    return { ok:true, clicked:true, state: readState(el) };
  })()`
}

/**
 * Apply a single tool toggle on the given page.
 * @param enable desired state; omit for a pure flip.
 */
export async function applyToolToggle(
  webContents: WebContents,
  tool: ToolToggle,
  enable?: boolean,
): Promise<ToolToggleResult> {
  try {
    // Step 1: open the containing menu first, if the tool lives in one.
    if (tool.menuTriggerSelector) {
      const opened = (await webContents.executeJavaScript(
        `(function(){var el=document.querySelector(${JSON.stringify(tool.menuTriggerSelector)});if(!el)return false;el.click();return true;})()`,
      )) as boolean
      if (!opened) {
        return { ok: false, clicked: false, state: null, reason: 'menu-trigger-not-found' }
      }
      await delay(350)
    }

    const result = (await webContents.executeJavaScript(
      buildToggleScript(tool, enable),
    )) as ToolToggleResult

    // If we opened a menu but didn't click anything, close it again.
    if (tool.menuTriggerSelector && result && result.clicked === false) {
      await webContents
        .executeJavaScript(
          `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27,bubbles:true}));true`,
        )
        .catch(() => {})
    }
    return result
  } catch (err) {
    log.warn('tool-toggle: apply failed', { tool: tool.id, err: String(err) })
    return { ok: false, clicked: false, state: null, reason: String(err) }
  }
}

/**
 * Best-effort: ensure each tool id in `toolIds` is ON before a send.
 * Idempotent (applyToolToggle only clicks when needed). Failures are logged
 * and swallowed — they must never block a chat dispatch.
 */
export async function ensureToolsEnabled(
  webContents: WebContents,
  config: SiteConfig,
  toolIds: string[],
): Promise<void> {
  if (!toolIds.length || !config.toolToggles?.length) return
  for (const toolId of toolIds) {
    const tool = config.toolToggles.find((t) => t.id === toolId)
    if (!tool) continue
    const r = await applyToolToggle(webContents, tool, true)
    if (!r.ok) {
      log.info('tool-toggle: ensure skipped', { siteId: config.siteId, toolId, reason: r.reason })
    }
  }
}

/**
 * Best-effort: ensure every tool in `config.activeTools` is ON before a send.
 */
export async function ensureActiveTools(
  webContents: WebContents,
  config: SiteConfig,
): Promise<void> {
  await ensureToolsEnabled(webContents, config, config.activeTools ?? [])
}
