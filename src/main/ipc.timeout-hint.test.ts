import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { deriveTimeoutHintFromText } from './ipc'

describe('deriveTimeoutHintFromText()', () => {
  it('returns ssl/certificate hint for handshake failures', () => {
    const hint = deriveTimeoutHintFromText('ssl_client_socket_impl handshake failed net_error -101')
    expect(hint).toContain('证书/SSL')
  })

  it('returns network hint for generic network failures', () => {
    const hint = deriveTimeoutHintFromText('Network error: failed to fetch conversation')
    expect(hint).toContain('网络连接异常')
  })

  it('returns risk/verify hint for verification prompts', () => {
    const hint = deriveTimeoutHintFromText('Unusual activity detected, please verify')
    expect(hint).toContain('验证/风控')
  })

  it('returns undefined when no known error signal', () => {
    expect(deriveTimeoutHintFromText('normal content chunk')).toBeUndefined()
  })
})

