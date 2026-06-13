/* ------------------------------------------------------------------ */
/*  src/main/ipc.reply-fallback.test.ts                               */
/*                                                                      */
/*  Regression tests for the network-interceptor → DOM-watcher         */
/*  fallback decision in chat:send (registerChatIpc).                  */
/*                                                                      */
/*  Before the fix: timedOut=true was treated as "accepted", so the    */
/*  DOM watcher never ran after a network timeout — users got empty     */
/*  replies even though the DOM had content.                           */
/*                                                                      */
/*  Tests assert on networkInterceptorAccepted() — the pure function   */
/*  extracted from the replyPromise IIFE — which is the exact          */
/*  conditional that governs the branch.                               */
/* ------------------------------------------------------------------ */

import { describe, it, expect } from 'vitest'

// Mock electron-log before importing the module under test
import { vi } from 'vitest'
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { networkInterceptorAccepted } from './ipc'

// ─── Regression: timedOut must NOT be accepted ────────────────────────────────

describe('networkInterceptorAccepted() — regression: timedOut/empty must fallback to DOM watcher', () => {
  it(
    'returns false when timedOut=true and text is empty — network timeout must trigger DOM fallback',
    () => {
      // Before the fix: `timedOut` was included in the "accepted" OR-condition, so
      // { text: '', timedOut: true } was returned directly and watchForReply() was
      // never called, producing an empty chat:reply for the user.
      // After the fix: timedOut is no longer accepted; DOM watcher runs instead.
      const result = networkInterceptorAccepted({ text: '', timedOut: true })
      expect(result).toBe(false)
    },
  )

  it(
    'returns true when text is non-empty — network content must NOT trigger DOM fallback',
    () => {
      // Ensures the "happy path" still works: if the interceptor got real content,
      // we must NOT call watchForReply() (which would waste another 120s timeout).
      const result = networkInterceptorAccepted({ text: 'from network', timedOut: false })
      expect(result).toBe(true)
    },
  )
})

// ─── Full coverage of all branches ────────────────────────────────────────────

describe('networkInterceptorAccepted() — all branches', () => {
  it('returns false for null-like empty result (text undefined, no images)', () => {
    expect(networkInterceptorAccepted({})).toBe(false)
  })

  it('returns false for whitespace-only text', () => {
    expect(networkInterceptorAccepted({ text: '   ' })).toBe(false)
  })

  it('returns false for author-label-only text', () => {
    expect(networkInterceptorAccepted({ text: 'ChatGPT 说：' })).toBe(false)
  })

  it('returns false for empty imageUrls array', () => {
    expect(networkInterceptorAccepted({ imageUrls: [] })).toBe(false)
  })

  it('returns true for quotaExhausted (no text needed)', () => {
    expect(networkInterceptorAccepted({ quotaExhausted: true, text: '' })).toBe(true)
  })

  it('returns true for non-empty imageUrls', () => {
    expect(networkInterceptorAccepted({ imageUrls: ['https://example.com/img.png'] })).toBe(true)
  })
})
