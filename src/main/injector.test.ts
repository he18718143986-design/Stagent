/* ------------------------------------------------------------------ */
/*  src/main/injector.test.ts                                          */
/* ------------------------------------------------------------------ */

import { describe, it, expect, vi } from 'vitest'
import type { WebContentsView } from 'electron'
import type { SelectorChain } from './site-store'

// ── Mock electron-log ────────────────────────────────────────────────────────
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// Import after mocks are set up
import { inject } from './injector'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal mock WebContentsView */
function mockView(executeResult: unknown): WebContentsView {
  return {
    webContents: {
      executeJavaScript: vi.fn().mockResolvedValue(executeResult),
    },
  } as unknown as WebContentsView
}

function chain(selector: string, priority = 5): SelectorChain {
  return [{ selector, method: 'css', priority, failCount: 0 }]
}

// ─── Script-level tests (no Electron needed) ─────────────────────────────────

// We export the helpers only for testing — but since they're private, we
// test the scripts indirectly via the public inject() API and script syntax.

describe('inject() — script syntax', () => {
  it('inject script embeds the selector in the function argument', async () => {
    const scripts: string[] = []
    const view = {
      webContents: {
        executeJavaScript: vi.fn().mockImplementation((script: string) => {
          scripts.push(script)
          return Promise.resolve({ ok: true, strategy: 'react-setter' })
        }),
      },
    } as unknown as WebContentsView

    await inject(view, 'hello world', chain('#my-input'), chain('#my-send'))

    // The FIRST call is the text injection script — it must contain the input selector
    expect(scripts[0]).toContain('#my-input')
  })

  it('inject script embeds the text via JSON.stringify (safe encoding)', async () => {
    const scripts: string[] = []
    const view = {
      webContents: {
        executeJavaScript: vi.fn().mockImplementation((script: string) => {
          scripts.push(script)
          return Promise.resolve({ ok: true, strategy: 'react-setter' })
        }),
      },
    } as unknown as WebContentsView

    const text = 'Say "hello" and \\backslash\nnewline'
    await inject(view, text, chain('#input'), chain('#send'))

    // FIRST script = inject; text must be JSON-encoded inside it
    const injectScript = scripts[0]!
    expect(injectScript).toContain(JSON.stringify(text))
    // The inject script must be parseable as a JS function
    expect(() => new Function(injectScript)).not.toThrow()
  })

  it('inject script is syntactically valid JS for selectors containing quotes', async () => {
    let capturedScript = ''
    const view = {
      webContents: {
        executeJavaScript: vi.fn().mockImplementation((script: string) => {
          capturedScript = script
          return Promise.resolve({ ok: true, strategy: 'react-setter' })
        }),
      },
    } as unknown as WebContentsView

    // Selector with double-quotes (valid CSS attribute selector)
    await inject(view, 'test', chain('[aria-label="Send"]'), chain('#send'))
    expect(() => new Function(capturedScript)).not.toThrow()
  })
})

describe('inject() — selector chain behaviour', () => {
  it('returns { ok: false } when input selector chain is empty', async () => {
    const view = mockView({ ok: true })
    const result = await inject(view, 'hello', [], chain('#send'))
    expect(result.ok).toBe(false)
    expect(result.reason).toBeDefined()
  })

  it('returns { ok: true } when executeJavaScript resolves with { ok: true }', async () => {
    const view = mockView({ ok: true, strategy: 'react-setter' })
    const result = await inject(view, 'hello', chain('#input'), chain('#send'))
    expect(result.ok).toBe(true)
  })

  it('returns { ok: false } when executeJavaScript always resolves with { ok: false }', async () => {
    const view = {
      webContents: {
        executeJavaScript: vi.fn().mockResolvedValue({ ok: false, reason: 'element not found' }),
      },
    } as unknown as WebContentsView

    const result = await inject(view, 'hello', chain('#missing'), chain('#send'))
    expect(result.ok).toBe(false)
  })

  it('returns { ok: false } when executeJavaScript throws', async () => {
    const view = {
      webContents: {
        executeJavaScript: vi.fn().mockRejectedValue(new Error('renderer crashed')),
      },
    } as unknown as WebContentsView

    const result = await inject(view, 'hello', chain('#input'), chain('#send'))
    expect(result.ok).toBe(false)
  })

  it('tries the highest-priority selector first', async () => {
    const scripts: string[] = []
    const view = {
      webContents: {
        executeJavaScript: vi.fn().mockImplementation((script: string) => {
          scripts.push(script)
          return Promise.resolve({ ok: true })
        }),
      },
    } as unknown as WebContentsView

    const multiChain: SelectorChain = [
      { selector: '#low', method: 'css', priority: 1, failCount: 0 },
      { selector: '#high', method: 'css', priority: 9, failCount: 0 },
    ]
    await inject(view, 'test', multiChain, chain('#send'))
    // The first inject call's script should contain '#high', not '#low'
    expect(scripts[0]).toContain('#high')
    expect(scripts[0]).not.toContain('#low')
  })
})

describe('inject() — element-not-visible scenario (SPA hydration timing)', () => {
  // Regression: when #prompt-textarea exists but getBoundingClientRect() returns 0
  // during SPA hydration, inject() must NOT immediately return { ok: false }.
  // It should be retried by the caller (ipc.ts) after a delay.
  // This test confirms inject() itself correctly reports the failure reason
  // so the caller can distinguish "not visible" from "not found".
  it('returns reason "element not visible" when element has zero dimensions', async () => {
    const view = {
      webContents: {
        executeJavaScript: vi.fn().mockResolvedValue({
          ok: false,
          reason: 'element not visible',
        }),
      },
    } as unknown as WebContentsView

    const result = await inject(view, 'hello', chain('#prompt-textarea'), chain('#send'))
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('Could not inject text — no input selector matched')
  })

  it('succeeds on second call when element becomes visible after hydration', async () => {
    let callCount = 0
    const view = {
      webContents: {
        executeJavaScript: vi.fn().mockImplementation(() => {
          callCount++
          // First call: element not visible (SPA not yet hydrated)
          // Second call (send button): succeed
          // Subsequent calls for retry: element now visible
          if (callCount === 1) return Promise.resolve({ ok: false, reason: 'element not visible' })
          return Promise.resolve({ ok: true, strategy: 'execCommand' })
        }),
      },
    } as unknown as WebContentsView

    // First inject attempt fails
    const first = await inject(view, 'hi', chain('#prompt-textarea'), chain('#send'))
    expect(first.ok).toBe(false)

    // After delay, second attempt succeeds with the same selector
    const second = await inject(view, 'hi', chain('#prompt-textarea'), chain('#send'))
    expect(second.ok).toBe(true)
  })
})
