/* ------------------------------------------------------------------ */
/*  src/main/ipc.reply-race.test.ts                                   */
/*                                                                      */
/*  Regression tests for the settle-once race coordinator in           */
/*  chat:send (raceReply).                                              */
/*                                                                      */
/*  Before the fix: the reply chain was serial — network was awaited   */
/*  first, then dom started (or domPromise was awaited after network).  */
/*  This meant that if dom finished at T=2s but network timed out at   */
/*  T=120s, the user waited 120s AND a second chat:reply could be sent. */
/*                                                                      */
/*  After the fix: raceReply() makes network and dom compete;          */
/*  the first acceptable result wins; the late arrival is discarded.   */
/* ------------------------------------------------------------------ */

import { describe, it, expect, vi } from 'vitest'
import type { WatchResult } from './response-watcher'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { raceReply } from './ipc'

// ─── Test 1: DOM wins first, late network timeout is ignored ──────────────────

describe(
  'raceReply() — regression: dom first, late network timeout must not cause second settlement',
  () => {
    it(
      'settles with dom result; late network (timedOut=true) triggers onLate, not a second settle',
      async () => {
        // Before the fix: the replyPromise IIFE awaited interceptorPromise first,
        // so even if domPromise resolved at T=2s the chat:reply was delayed until
        // network timed out at T=120s; and a separate domPromise .then() could
        // send a duplicate chat:reply.
        // After the fix: dom settles the race first; network calls onLate.

        // dom resolves immediately (simulates fast DOM capture)
        const domP = Promise.resolve<WatchResult>({ text: 'dom ok' })

        // network resolves after dom (even though Promise.resolve is used here,
        // microtask ordering guarantees dom .then fires first because dom was
        // registered first inside raceReply)
        const networkP = Promise.resolve<WatchResult | null>({ text: '', timedOut: true })

        const onLate = vi.fn()
        const { source, result } = await raceReply(networkP, domP, onLate)

        expect(source).toBe('dom')
        expect(result.text).toBe('dom ok')
        // network was invalid (timedOut+empty) so it never called trySettle
        // → onLate is NOT called for it (it simply wasn't accepted)
        // This verifies that an invalid network result is silently dropped
        expect(onLate).not.toHaveBeenCalledWith('network')
      },
    )

    it(
      'onLate("dom") is called when dom arrives after network already settled',
      async () => {
        // Arrange: network resolves instantly with valid content
        let resolveDom!: (v: WatchResult) => void
        const domP = new Promise<WatchResult>((r) => { resolveDom = r })
        const networkP = Promise.resolve<WatchResult | null>({ text: 'net ok' })

        const onLate = vi.fn()
        const raceP = raceReply(networkP, domP, onLate)

        // network settles first
        const { source, result } = await raceP
        expect(source).toBe('network')
        expect(result.text).toBe('net ok')

        // Now dom arrives late
        resolveDom({ text: 'dom late' })
        // Let microtasks drain
        await Promise.resolve()
        await Promise.resolve()

        // dom was late → onLate must have been called
        expect(onLate).toHaveBeenCalledWith('dom')
        expect(onLate).toHaveBeenCalledTimes(1)
      },
    )
  },
)

// ─── Test 2: network wins first, late DOM is ignored ─────────────────────────

describe(
  'raceReply() — regression: network first, late dom must not cause second settlement',
  () => {
    it(
      'settles with network result; late dom triggers onLate, not a second settle',
      async () => {
        // Before the fix: dom was started after network resolved, so if network
        // won there was no "late dom" problem — but if dom was also awaited
        // separately (e.g. via an old replyPromise IIFE), it could send twice.
        // After the fix: raceReply guarantees a single settlement.

        let resolveDom!: (v: WatchResult) => void
        const domP = new Promise<WatchResult>((r) => { resolveDom = r })
        const networkP = Promise.resolve<WatchResult | null>({ text: 'net ok' })

        const onLate = vi.fn()
        const raceP = raceReply(networkP, domP, onLate)

        const { source, result } = await raceP
        expect(source).toBe('network')
        expect(result.text).toBe('net ok')

        // Simulate dom arriving later with valid text
        resolveDom({ text: 'dom late' })
        await Promise.resolve()
        await Promise.resolve()

        // dom was late → must have been discarded via onLate
        expect(onLate).toHaveBeenCalledWith('dom')
        expect(onLate).toHaveBeenCalledTimes(1)
      },
    )

    it('null network (not configured) → dom settles normally', async () => {
      const domP = Promise.resolve<WatchResult>({ text: 'dom result' })
      const networkP = Promise.resolve<WatchResult | null>(null)
      const onLate = vi.fn()

      const { source, result } = await raceReply(networkP, domP, onLate)
      expect(source).toBe('dom')
      expect(result.text).toBe('dom result')
      expect(onLate).not.toHaveBeenCalled()
    })

    it('dom author-label is ignored; later valid network result should win', async () => {
      const domP = Promise.resolve<WatchResult>({ text: 'ChatGPT 说：' })
      const networkP = Promise.resolve<WatchResult | null>({ text: 'network real reply' })
      const onLate = vi.fn()

      const { source, result } = await raceReply(networkP, domP, onLate)
      expect(source).toBe('network')
      expect(result.text).toBe('network real reply')
      expect(onLate).not.toHaveBeenCalled()
    })

    it('both invalid and dom is author-label -> final fallback must be empty text', async () => {
      const domP = Promise.resolve<WatchResult>({ text: 'ChatGPT 说：' })
      const networkP = Promise.resolve<WatchResult | null>({ text: '', timedOut: true })
      const onLate = vi.fn()

      const { source, result } = await raceReply(networkP, domP, onLate)
      expect(source).toBe('dom')
      expect(result.text).toBe('')
      expect(result.timedOut).toBe(true)
    })

    it('quotaExhausted network result settles race before dom', async () => {
      let resolveDom!: (v: WatchResult) => void
      const domP = new Promise<WatchResult>((r) => { resolveDom = r })
      const networkP = Promise.resolve<WatchResult | null>({ quotaExhausted: true, text: '' })
      const onLate = vi.fn()

      const raceP = raceReply(networkP, domP, onLate)
      const { source, result } = await raceP
      expect(source).toBe('network')
      expect(result.quotaExhausted).toBe(true)

      resolveDom({ text: 'dom' })
      await Promise.resolve()
      await Promise.resolve()
      expect(onLate).toHaveBeenCalledWith('dom')
    })
  },
)
