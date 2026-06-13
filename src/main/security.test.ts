/* ------------------------------------------------------------------ */
/*  src/main/security.test.ts                                          */
/* ------------------------------------------------------------------ */

import { describe, expect, it } from 'vitest'
import {
  assertChatText,
  assertRenameLabel,
  assertSelectorFields,
  assertSiteId,
  assertSiteUrl,
  canOpenExternally,
  shouldLoadPopupInApp,
} from './security'

describe('security helpers', () => {
  it('accepts https site URLs', () => {
    expect(assertSiteUrl('https://chatgpt.com')).toBe('https://chatgpt.com/')
  })

  it('accepts loopback http URLs for local testing', () => {
    expect(assertSiteUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000/')
  })

  it('rejects non-loopback http URLs', () => {
    expect(() => assertSiteUrl('http://example.com')).toThrow(/仅支持 https/)
  })

  it('rejects javascript URLs', () => {
    expect(() => assertSiteUrl('javascript:alert(1)')).toThrow(/仅支持 https/)
  })

  it('rejects site IDs that are not UUIDs', () => {
    expect(() => assertSiteId('site-1')).toThrow(/UUID/)
  })

  it('allows same-origin popups only while login is visible', () => {
    expect(
      shouldLoadPopupInApp('https://chatgpt.com', 'https://chatgpt.com/auth/callback', true),
    ).toBe(true)
    expect(
      shouldLoadPopupInApp('https://chatgpt.com', 'https://chatgpt.com/auth/callback', false),
    ).toBe(false)
  })

  it('allows known OAuth providers during login', () => {
    expect(
      shouldLoadPopupInApp('https://claude.ai', 'https://accounts.google.com/o/oauth2/v2/auth', true),
    ).toBe(true)
  })

  it('blocks arbitrary external popups in-app', () => {
    expect(
      shouldLoadPopupInApp('https://chatgpt.com', 'https://evil.example.com/phish', true),
    ).toBe(false)
  })

  it('validates selector field payloads', () => {
    const fields = assertSelectorFields({
      inputSelectors: [{ selector: '#prompt', method: 'css', priority: 10, failCount: 0 }],
      quotaExhaustedIndicator: 'text=limit reached',
    })
    expect(fields.inputSelectors?.[0]?.selector).toBe('#prompt')
    expect(fields.quotaExhaustedIndicator).toBe('text=limit reached')
  })

  it('rejects unsupported selector field keys', () => {
    expect(() => assertSelectorFields({ badKey: 'x' })).toThrow(/不支持的 selector 字段/)
  })

  it('rejects empty chat text and blank rename labels', () => {
    expect(() => assertChatText('   ')).toThrow(/不能为空/)
    expect(() => assertRenameLabel('   ')).toThrow(/不能为空/)
  })

  it('limits external opening to http/https loopback or https', () => {
    expect(canOpenExternally('https://example.com')).toBe(true)
    expect(canOpenExternally('http://127.0.0.1:4000')).toBe(true)
    expect(canOpenExternally('file:///tmp/demo.html')).toBe(false)
  })
})
