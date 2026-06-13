/**
 * Tests for ChatPage quota handling and basic navigation.
 *
 * ChatPage calls window.autoAI.* which is mocked in setup.ts.
 * We test the component through its rendered output without mocking internal state.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import React from 'react'
import { NavigationContext } from '../App'
import type { Page } from '../App'
import type { SiteWithStatus } from '../../../preload/index.d'

// Dynamic import of ChatPage to pick up the mocked window.autoAI from setup.ts
import ChatPage from '../pages/ChatPage'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSite(overrides: Partial<SiteWithStatus> = {}): SiteWithStatus {
  return {
    siteId: 'site-1',
    label: 'ChatGPT',
    hostname: 'chatgpt.com',
    url: 'https://chatgpt.com',
    status: 'connected',
    outputType: 'text',
    inputSelectors: [],
    sendSelectors: [],
    responseSelectors: [],
    calibrated: true,
    addedAt: Date.now(),
    ...overrides,
  }
}

function renderChatPage(
  goFn: (p: Page) => void = vi.fn(),
  activeSiteId: string | null = null,
): ReturnType<typeof render> {
  return render(
    <NavigationContext.Provider value={{ go: goFn }}>
      <ChatPage activeSiteId={activeSiteId} onActiveSiteIdChange={vi.fn()} />
    </NavigationContext.Provider>
  )
}

function mockSiteList(): ReturnType<typeof vi.mocked<typeof window.autoAI.site.list>> {
  return vi.mocked(window.autoAI.site.list)
}

function mockOnQuotaExhausted(): ReturnType<typeof vi.mocked<typeof window.autoAI.chat.onQuotaExhausted>> {
  return vi.mocked(window.autoAI.chat.onQuotaExhausted)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ChatPage — initial render', () => {
  it('shows empty-state message when no sites are connected', async () => {
    mockSiteList().mockResolvedValue([])
    renderChatPage()
    await waitFor(() => expect(screen.getByText('还没有可用的 AI')).toBeTruthy())
  })

  it('shows "···" menu button when a connected site exists', async () => {
    mockSiteList().mockResolvedValue([makeSite({ siteId: 's1', label: 'Claude' })])
    renderChatPage(vi.fn(), 's1')
    await waitFor(() => expect(screen.getByLabelText('更多')).toBeTruthy())
  })

  it('shows empty-chat prompt when sites are connected', async () => {
    mockSiteList().mockResolvedValue([makeSite()])
    renderChatPage()
    await waitFor(() => expect(screen.getByText('发送一条消息开始对话')).toBeTruthy())
  })
})

describe('ChatPage — quota-exhausted handling', () => {
  it('keeps the current site selected and shows a manual-switch notice', async () => {
    const site1 = makeSite({ siteId: 's1', label: 'GPT-4', status: 'connected' })
    const site2 = makeSite({ siteId: 's2', label: 'Claude', status: 'connected', hostname: 'claude.ai' })

    // Initial load returns both connected
    mockSiteList().mockResolvedValue([site1, site2])

    // Capture the quota-exhausted callback so we can trigger it manually
    let quotaCb: ((siteId: string) => void) | null = null
    mockOnQuotaExhausted().mockImplementation((cb: (siteId: string) => void) => {
      quotaCb = cb
      return vi.fn()
    })

    // After quota event, list shows s1 as quota-exhausted
    const afterQuota = [
      { ...site1, status: 'quota-exhausted' as const },
      { ...site2, status: 'connected' as const },
    ]

    renderChatPage(vi.fn(), 's1')

    // Wait for initial load
    await waitFor(() => expect(window.autoAI.site.list).toHaveBeenCalled())

    // Trigger quota exhausted on site1; the component will call list() again
    mockSiteList().mockResolvedValue(afterQuota)
    act(() => { quotaCb?.('s1') })

    await waitFor(() =>
      expect(screen.getByText('今日额度已用尽，请从上方标签栏切换其他账号继续对话')).toBeTruthy()
    )
  })

  it('shows "all-exhausted" message when no connected sites remain', async () => {
    const site1 = makeSite({ siteId: 's1', label: 'GPT-4', status: 'connected' })

    mockSiteList().mockResolvedValue([site1])

    let quotaCb: ((siteId: string) => void) | null = null
    mockOnQuotaExhausted().mockImplementation((cb: (siteId: string) => void) => {
      quotaCb = cb
      return vi.fn()
    })

    renderChatPage(vi.fn(), 's1')
    await waitFor(() => expect(window.autoAI.site.list).toHaveBeenCalled())

    // After quota, s1 is exhausted, no other sites
    mockSiteList().mockResolvedValue([{ ...site1, status: 'quota-exhausted' as const }])
    act(() => { quotaCb?.('s1') })

    await waitFor(() =>
      expect(screen.getByText(/所有账号额度已用尽/)).toBeTruthy()
    )
  })
})

describe('ChatPage — navigate to ResourcesPage', () => {
  it('navigates to /resources when "连接一个 AI" button is clicked', async () => {
    const go = vi.fn()
    mockSiteList().mockResolvedValue([])
    renderChatPage(go)

    await waitFor(() => screen.getByText('连接一个 AI →'))
    screen.getByText('连接一个 AI →').click()
    expect(go).toHaveBeenCalledWith('/resources')
  })
})
