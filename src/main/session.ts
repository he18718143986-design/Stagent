/* ------------------------------------------------------------------ */
/*  src/main/session.ts — Per-site persistent browser sessions        */
/*  M10: keyed by siteId (UUID) instead of hostname so multiple       */
/*       accounts on the same domain each get their own cookie jar.   */
/* ------------------------------------------------------------------ */

import { session, Session } from 'electron'
import log from 'electron-log'

/**
 * Returns (or creates) a persistent Electron Session for a given siteId.
 * Each site record gets its own isolated cookie jar so multiple accounts
 * on the same domain (e.g. two ChatGPT logins) never cross-contaminate.
 *
 * Session data is stored at:
 *   ~/Library/Application Support/autoai/Partitions/autoai-{siteId}/
 *
 * The session persists across app restarts — users only need to log in once.
 */
export function getSession(siteId: string): Session {
  const partition = `persist:autoai-${siteId}`
  const s = session.fromPartition(partition, { cache: true })
  log.debug('session: resolved', { siteId, partition })
  return s
}

/**
 * Clears all cookies and storage for a site's session.
 * Called when the user explicitly removes a site.
 */
export async function clearSession(siteId: string): Promise<void> {
  const partition = `persist:autoai-${siteId}`
  const s = session.fromPartition(partition)
  await s.clearStorageData()
  await s.clearCache()
  log.info('session: cleared', { siteId, partition })
}
