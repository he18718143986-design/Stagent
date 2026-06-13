import { describe, it, expect, afterEach } from 'vitest'
import { resolveAutomationMode, resolveCdpPort } from './mode'

describe('resolveAutomationMode()', () => {
  afterEach(() => {
    delete process.env.AUTOAI_AUTOMATION_MODE
    delete process.env.AUTOAI_PLAYWRIGHT_HOSTS
  })

  it('defaults to legacy', () => {
    expect(resolveAutomationMode('chatgpt.com')).toBe('legacy')
  })

  it('honours AUTOAI_AUTOMATION_MODE=playwright', () => {
    process.env.AUTOAI_AUTOMATION_MODE = 'playwright'
    expect(resolveAutomationMode('example.com')).toBe('playwright')
  })

  it('AUTOAI_PLAYWRIGHT_HOSTS graylist overrides global legacy', () => {
    process.env.AUTOAI_PLAYWRIGHT_HOSTS = 'chatgpt.com,kimi'
    expect(resolveAutomationMode('chatgpt.com')).toBe('playwright')
    expect(resolveAutomationMode('www.chatgpt.com')).toBe('playwright')
    expect(resolveAutomationMode('claude.ai')).toBe('legacy')
  })
})

describe('resolveCdpPort()', () => {
  afterEach(() => {
    delete process.env.AUTOAI_CDP_PORT
  })

  it('defaults to 9223', () => {
    expect(resolveCdpPort()).toBe('9223')
  })

  it('reads AUTOAI_CDP_PORT', () => {
    process.env.AUTOAI_CDP_PORT = '9333'
    expect(resolveCdpPort()).toBe('9333')
  })
})
