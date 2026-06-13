/* ------------------------------------------------------------------ */
/*  src/main/ipc.parallel-reply.test.ts                               */
/*                                                                      */
/*  Regression tests for the parallel network+DOM reply strategy in   */
/*  chat:send (registerChatIpc).                                        */
/*                                                                      */
/*  Before the fix: watchForReply() was only started AFTER             */
/*  interceptorPromise resolved — causing a serial 120 s + 120 s       */
/*  double-timeout when the network interceptor fired but got nothing. */
/*                                                                      */
/*  After the fix: domPromise is started in parallel; when network     */
/*  returns invalid/timedOut, the already-running domPromise is        */
/*  returned immediately (no second serial wait).                      */
/* ------------------------------------------------------------------ */

import { describe, it, expect, vi } from 'vitest'
import type { WatchResult } from './response-watcher'

// Mock electron-log before importing the module under test
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { pickReply } from './ipc'
import { hasExtractableContent } from './response-watcher'

// ─── Test 1: network invalid → dom result returned (no second serial wait) ────

describe(
  'pickReply() — regression: network invalid must not cause serial 120s+120s wait',
  () => {
    it(
      'returns dom result when network times out with empty text',
      async () => {
        // Before the fix: watchForReply() was only called after interceptorPromise
        // resolved, so an invalid network result meant starting a SECOND 120 s wait.
        // After the fix: domPromise is already running; returning it is instant.
        const networkP = Promise.resolve<WatchResult>({ text: '', timedOut: true })
        const domP = Promise.resolve<WatchResult>({ text: 'dom ok' })
        const result = await pickReply(networkP, domP)
        expect(result.text).toBe('dom ok')
      },
    )

    it('returns dom result when network interceptor is not configured (null)', async () => {
      const networkP = Promise.resolve<WatchResult | null>(null)
      const domP = Promise.resolve<WatchResult>({ text: 'dom result' })
      const result = await pickReply(networkP, domP)
      expect(result.text).toBe('dom result')
    })

    it('returns network result when network has valid content', async () => {
      const networkP = Promise.resolve<WatchResult>({ text: 'network reply', timedOut: false })
      const domP = Promise.resolve<WatchResult>({ text: 'dom result' })
      const result = await pickReply(networkP, domP)
      expect(result.text).toBe('network reply')
    })

    it('returns network result when quotaExhausted (no content needed)', async () => {
      const networkP = Promise.resolve<WatchResult>({ quotaExhausted: true, text: '' })
      const domP = Promise.resolve<WatchResult>({ text: 'dom result' })
      const result = await pickReply(networkP, domP)
      expect(result.quotaExhausted).toBe(true)
    })
  },
)

// ─── Test 2: watcher late-start immediate extract guard ───────────────────────

describe(
  'hasExtractableContent() — regression: watcher must resolve immediately when content already present',
  () => {
    it(
      'returns true when text is present — late-start watcher should finish immediately',
      () => {
        // Before the late-start fix: the IIFE only resolved via mutation-based
        // detection.  If content was already present when watchForReply() was
        // called (late start), mutations had already fired and the watcher would
        // time out after 120 s instead of resolving immediately.
        // After the fix: an immediate extractBestResult() check fires after
        // observer init, guarded by hasExtractableContent() logic.
        expect(hasExtractableContent({ text: 'AI reply here' }, 'text')).toBe(true)
        expect(hasExtractableContent({ text: '  trimmed  ' }, 'text')).toBe(true)
      },
    )

    it(
      'returns false when text is empty — watcher must not resolve prematurely',
      () => {
        // Ensures we don't immediately resolve on empty or author-label text.
        expect(hasExtractableContent({ text: '' }, 'text')).toBe(false)
        expect(hasExtractableContent({ text: '   ' }, 'text')).toBe(false)
        expect(hasExtractableContent({}, 'text')).toBe(false)
      },
    )

    it('returns true for non-empty imageUrls in image mode', () => {
      expect(hasExtractableContent({ imageUrls: ['https://example.com/img.png'] }, 'image')).toBe(true)
    })

    it('returns false for empty imageUrls in image mode', () => {
      expect(hasExtractableContent({ imageUrls: [] }, 'image')).toBe(false)
      expect(hasExtractableContent({}, 'image')).toBe(false)
    })
  },
)
