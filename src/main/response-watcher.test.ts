/* ------------------------------------------------------------------ */
/*  src/main/response-watcher.test.ts                                  */
/* ------------------------------------------------------------------ */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { WebContentsView } from 'electron'
import type { SelectorChain } from './site-store'

// ── Mock electron-log ────────────────────────────────────────────────────────
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { watchForReply, isLikelyAuthorLabel, onStableShouldFinish } from './response-watcher'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function chain(selector: string): SelectorChain {
  return [{ selector, method: 'css', priority: 5, failCount: 0 }]
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('watchForReply()', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves with text when executeJavaScript returns a done reply', async () => {
    const view = {
      webContents: {
        executeJavaScript: vi.fn().mockResolvedValue({ text: 'Hello from AI' }),
      },
    } as unknown as WebContentsView

    const promise = watchForReply(view, chain('.reply'), 'text')
    // Advance timers to let any internal setTimeout(…, 125_000) not block
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.text).toBe('Hello from AI')
    expect(result.timedOut).toBeFalsy()
    expect(result.quotaExhausted).toBeFalsy()
  })

  it('resolves with quotaExhausted when executeJavaScript returns quota flag', async () => {
    const view = {
      webContents: {
        executeJavaScript: vi.fn().mockResolvedValue({ quotaExhausted: true }),
      },
    } as unknown as WebContentsView

    const promise = watchForReply(view, chain('.reply'), 'text', 'text=Limit reached')
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.quotaExhausted).toBe(true)
    expect(result.text).toBeUndefined()
  })

  it('resolves with timedOut when executeJavaScript never settles (main-process timeout wins)', async () => {
    // executeJavaScript never resolves (simulates page hang)
    const view = {
      webContents: {
        executeJavaScript: vi.fn().mockReturnValue(new Promise(() => {})),
      },
    } as unknown as WebContentsView

    const promise = watchForReply(view, chain('.reply'), 'text')

    // Advance past the 125_000ms hard timeout in watchForReply
    await vi.advanceTimersByTimeAsync(130_000)
    const result = await promise

    expect(result.timedOut).toBe(true)
  })

  it('returns empty result when selector chain is empty', async () => {
    const view = {
      webContents: {
        executeJavaScript: vi.fn().mockResolvedValue({ text: '' }),
      },
    } as unknown as WebContentsView

    const promise = watchForReply(view, [], 'text')
    await vi.runAllTimersAsync()
    const result = await promise

    // No selector → watcher bails early with empty text
    expect(result.text).toBe('')
    expect(result.timedOut).toBeFalsy()
  })
})

describe('observer script syntax', () => {
  it('the injected script is syntactically valid JavaScript', async () => {
    // We extract the script by capturing what executeJavaScript receives
    let capturedScript = ''
    const view = {
      webContents: {
        executeJavaScript: vi.fn().mockImplementation((script: string) => {
          capturedScript = script
          return new Promise(() => {}) // never resolves; we only care about syntax
        }),
      },
    } as unknown as WebContentsView

    // Don't await — we just want the script to be injected
    watchForReply(view, chain('.reply'), 'text', 'text=Limit')

    // Give the synchronous part of watchForReply a tick to call executeJavaScript
    await Promise.resolve()

    expect(capturedScript).not.toBe('')
    expect(() => new Function(capturedScript)).not.toThrow()
  })
})

describe('watchForReply() — log statement regression', () => {
  // Regression: the log line inside watchForReply referenced `quotaIndicators`
  // which is only defined inside buildObserverScript(), causing:
  //   ReferenceError: quotaIndicators is not defined
  // The fix uses `indicator` (the local variable in watchForReply's scope).
  // This test confirms the function does NOT throw before executeJavaScript resolves.
  it('does not throw ReferenceError when quotaExhaustedIndicator is provided', async () => {
    const view = {
      webContents: {
        executeJavaScript: vi.fn().mockResolvedValue({ text: 'ok' }),
      },
    } as unknown as WebContentsView

    await expect(
      watchForReply(view, chain('.reply'), 'text', 'text=Limit reached')
    ).resolves.not.toThrow()
  })

  it('does not throw ReferenceError when quotaExhaustedIndicator is undefined', async () => {
    const view = {
      webContents: {
        executeJavaScript: vi.fn().mockResolvedValue({ text: 'ok' }),
      },
    } as unknown as WebContentsView

    await expect(
      watchForReply(view, chain('.reply'), 'text', undefined)
    ).resolves.not.toThrow()
  })
})

// ─── Regression: author-label filter ─────────────────────────────────────────

describe('isLikelyAuthorLabel() — regression: author headers must not be accepted as reply text', () => {
  it(
    'returns true for known role labels (ChatGPT说：, Assistant:, Claude, etc.)',
    () => {
      // Before the fix: extractBestResult() returned author-header text as the
      // final reply because `txt.length > 0` was the only guard.
      // After the fix: isLikelyAuthorLabel() causes those to be skipped.
      expect(isLikelyAuthorLabel('ChatGPT说：')).toBe(true)
      expect(isLikelyAuthorLabel('ChatGPT说:')).toBe(true)
      expect(isLikelyAuthorLabel('ChatGPT')).toBe(true)
      expect(isLikelyAuthorLabel('Assistant:')).toBe(true)
      expect(isLikelyAuthorLabel('assistant')).toBe(true)
      expect(isLikelyAuthorLabel('Claude:')).toBe(true)
      expect(isLikelyAuthorLabel('Gemini：')).toBe(true)
      expect(isLikelyAuthorLabel('Kimi')).toBe(true)
      expect(isLikelyAuthorLabel('DeepSeek：')).toBe(true)
      expect(isLikelyAuthorLabel('Copilot:')).toBe(true)
    },
  )

  it(
    'returns true for spaced variants and zero-width-char padded variants (ChatGPT DOM real-world)',
    () => {
      // Regression: before the normalization fix, "ChatGPT 说：" (space before 说)
      // or strings padded with \u200b zero-width spaces were NOT matched — the
      // filter silently let them through as "valid reply text".
      // After the fix: normalize() strips invisible chars + collapses whitespace
      // before testing, so all these variants are correctly identified.
      expect(isLikelyAuthorLabel('ChatGPT 说：')).toBe(true)   // space before 说
      expect(isLikelyAuthorLabel('ChatGPT 说 ：')).toBe(true)  // space around 说 and ：
      expect(isLikelyAuthorLabel('C h a t G P T 说：')).toBe(true) // fragmented whitespace
      expect(isLikelyAuthorLabel('ChatGPT\u200b说：')).toBe(true)  // zero-width space
      expect(isLikelyAuthorLabel('ChatGPT\u2060说：')).toBe(true)  // word joiner
      expect(isLikelyAuthorLabel('\u200bChatGPT说：\u200b')).toBe(true) // leading/trailing ZWS
      expect(isLikelyAuthorLabel('ChatGPT\u00a0说：')).toBe(true) // non-breaking space
      expect(isLikelyAuthorLabel('ChatGPT說：')).toBe(true) // traditional Chinese variant
      expect(isLikelyAuthorLabel('Assistant\u200b:')).toBe(true)
      expect(isLikelyAuthorLabel('Claude\u00a0:')).toBe(true)
    },
  )

  it(
    'returns false for normal body text — real reply content must not be filtered',
    () => {
      // Ensures that a response beginning with the model name but containing
      // body text is NOT accidentally filtered.
      expect(isLikelyAuthorLabel('ChatGPT说：这是一个完整回答。')).toBe(false)
      expect(isLikelyAuthorLabel('ChatGPT 说：这是一个完整回答。')).toBe(false)
      expect(isLikelyAuthorLabel('这是一个完整回答。')).toBe(false)
      expect(isLikelyAuthorLabel('Sure, here is the answer you requested.')).toBe(false)
      expect(isLikelyAuthorLabel('')).toBe(false)
    },
  )
})

// ─── Regression: onStable gate — must not block on hasNewContent ──────────────

describe('onStableShouldFinish() — regression: must resolve immediately when content already present', () => {
  it(
    'returns true when valid text exists — no baseline change needed to finish',
    () => {
      // Before the fix: onStable() started with `if (!hasNewContent(baselines)) return`
      // so if content existed before the observer or before the first stability
      // window (late-start / AI finished early), the watcher timed out at 120 s
      // even though extractBestResult() would have returned valid text.
      // After the fix: onStable() calls extractBestResult() first; if content is
      // present, finish() is called regardless of hasNewContent().
      expect(onStableShouldFinish({ text: 'Here is the answer.' }, 'text')).toBe(true)
      expect(onStableShouldFinish({ text: '  some reply  ' }, 'text')).toBe(true)
      expect(onStableShouldFinish({ imageUrls: ['https://example.com/img.png'] }, 'image')).toBe(true)
    },
  )

  it(
    'returns false when content is absent/empty — watcher must not finish prematurely',
    () => {
      // Ensures we do not resolve on empty text, author-only label, or missing
      // fields — the observer should keep watching (or the hard timeout fires).
      expect(onStableShouldFinish({ text: '' }, 'text')).toBe(false)
      expect(onStableShouldFinish({ text: '   ' }, 'text')).toBe(false)
      expect(onStableShouldFinish({}, 'text')).toBe(false)
      expect(onStableShouldFinish({ imageUrls: [] }, 'image')).toBe(false)
      expect(onStableShouldFinish({}, 'image')).toBe(false)
    },
  )
})
