/* ------------------------------------------------------------------ */
/*  src/main/selector-utils.ts — Shared CSS selector helpers          */
/*  Extracted from ipc.ts so browser-view.ts can also import it.      */
/* ------------------------------------------------------------------ */

import type { SiteConfig } from './site-store'

/**
 * Generic CSS selectors that match a visible chat-input on most AI sites.
 * Used as fallback when no site-specific selector is configured, and also
 * combined (OR) with the site-specific selector so that minor DOM changes
 * (e.g. a site dropping a specific attribute) don't break login detection.
 */
export const GENERIC_INPUT_SELECTOR =
  '[role="textbox"], div[contenteditable="true"], textarea:not([readonly]):not([disabled])'

/**
 * Builds a compound CSS selector for login detection.
 * Combines the site-specific narrow selector with GENERIC_INPUT_SELECTOR
 * fallbacks so minor DOM changes don't break detection.
 *
 * Used by: site:open-login, site:close-login, site:close-all-logins,
 *          probeOneSite, and startLoginPoll (via callers).
 */
export function buildInputSelector(config: Pick<SiteConfig, 'inputSelectors'>): string {
  const narrow = config.inputSelectors[0]?.selector ?? GENERIC_INPUT_SELECTOR
  return narrow.includes(GENERIC_INPUT_SELECTOR)
    ? narrow
    : `${narrow}, ${GENERIC_INPUT_SELECTOR}`
}
