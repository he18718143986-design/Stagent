/**
 * Vitest setup for renderer tests.
 * Mocks window.autoAI so components can render without Electron IPC.
 */
import { vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Build a minimal window.autoAI stub.  Individual tests can override
// specific methods using vi.mocked(...).mockResolvedValueOnce etc.
const autoAI = {
  ping: vi.fn(async () => 'pong'),
  site: {
    add: vi.fn(async () => ({ siteId: 'site-1', label: 'ChatGPT', hostname: 'chatgpt.com', url: 'https://chatgpt.com', inputSelectors: [], sendSelectors: [], responseSelectors: [], calibrated: false, addedAt: Date.now(), outputType: 'text' as const })),
    remove: vi.fn(async () => {}),
    list: vi.fn(async () => []),
    openLogin: vi.fn(async () => {}),
    closeLogin: vi.fn(async () => {}),
    closeAllLogins: vi.fn(async () => {}),
    updateSelectors: vi.fn(async () => {}),
    checkQuota: vi.fn(async () => ({ cleared: false })),
    showView: vi.fn(async () => ({ ok: true as const })),
    hideView: vi.fn(async () => ({ ok: true as const })),
    onLoginSuccess: vi.fn(() => vi.fn()),
    onStatusChanged: vi.fn(() => vi.fn()),
    onRuntimeEvent: vi.fn(() => vi.fn()),
    getRuntimePolicy: vi.fn(async () => ({ windowMs: 300_000, autoRecoverThreshold: 2 })),
    setRuntimePolicy: vi.fn(async (patch: { windowMs?: number; autoRecoverThreshold?: number }) => ({
      windowMs: patch.windowMs ?? 300_000,
      autoRecoverThreshold: patch.autoRecoverThreshold ?? 2,
    })),
    getRuntimeStats: vi.fn(async () => ({
      policy: { windowMs: 300_000, autoRecoverThreshold: 2 },
      totals: {
        'render-crash': 0,
        'webcontents-destroyed': 0,
        'network-fail': 0,
        'chat-interrupted': 0,
      },
      bySite: {},
    })),
    clearRuntimeStats: vi.fn(async () => ({ ok: true as const })),
    getNetworkDiagnostics: vi.fn(async () => null),
    refreshNetworkDiagnostics: vi.fn(async () => null),
    getLastChatFailure: vi.fn(async () => null),
    rename: vi.fn(async () => ({ ok: true as const })),
  },
  chat: {
    send: vi.fn(async () => ({})),
    onReply: vi.fn(() => vi.fn()),
    onQuotaExhausted: vi.fn(() => vi.fn()),
    switchModel: vi.fn(async () => ({ ok: true as const, modelLabel: 'GPT-4o' })),
    listModels: vi.fn(async () => ({ models: [], activeModel: undefined as string | undefined })),
    listTools: vi.fn(async () => ({ tools: [], activeTools: [] as string[] })),
    toggleTool: vi.fn(async () => ({ ok: true as const, enabled: true, activeTools: [] as string[] })),
  },
  calibrate: {
    start: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    onDone: vi.fn(() => vi.fn()),
    onStep: vi.fn(() => vi.fn()),
    onNeeded: vi.fn(() => vi.fn()),
  },
}

// Attach to window so components can call window.autoAI
Object.defineProperty(window, 'autoAI', {
  value: autoAI,
  writable: true,
  configurable: true,
})

// Reset call counts before each test so they don't bleed across tests
beforeEach(() => {
  vi.clearAllMocks()
  // Restore default return values cleared by clearAllMocks()
  autoAI.site.list.mockResolvedValue([])
  autoAI.site.add.mockResolvedValue({ siteId: 'site-1', label: 'ChatGPT', hostname: 'chatgpt.com', url: 'https://chatgpt.com', inputSelectors: [], sendSelectors: [], responseSelectors: [], calibrated: false, addedAt: Date.now(), outputType: 'text' as const })
  autoAI.site.checkQuota.mockResolvedValue({ cleared: false })
  autoAI.chat.send.mockResolvedValue({})
  autoAI.site.onLoginSuccess.mockReturnValue(vi.fn())
  autoAI.site.onStatusChanged.mockReturnValue(vi.fn())
  autoAI.site.onRuntimeEvent.mockReturnValue(vi.fn())
  autoAI.site.getRuntimeStats.mockResolvedValue({
    policy: { windowMs: 300_000, autoRecoverThreshold: 2 },
    totals: {
      'render-crash': 0,
      'webcontents-destroyed': 0,
      'network-fail': 0,
      'chat-interrupted': 0,
    },
    bySite: {},
  })
  autoAI.chat.onReply.mockReturnValue(vi.fn())
  autoAI.chat.onQuotaExhausted.mockReturnValue(vi.fn())
  autoAI.calibrate.onDone.mockReturnValue(vi.fn())
  autoAI.calibrate.onStep.mockReturnValue(vi.fn())
  autoAI.calibrate.onNeeded.mockReturnValue(vi.fn())
})

// silence act() warnings in test output
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom doesn't implement scrollIntoView — stub it out
Element.prototype.scrollIntoView = vi.fn()

// Clean up rendered components after each test
afterEach(() => cleanup())
