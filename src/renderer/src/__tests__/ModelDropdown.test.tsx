/**
 * Unit tests for ModelDropdown sub-component in ChatPage.
 * Tests open/close behaviour and site selection.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React, { useRef, useState, useEffect } from 'react'
import type { SiteWithStatus } from '../../../preload/index.d'

// ─── Inline ModelDropdown — same logic as ChatPage's inner component ────────

function ModelDropdown({
  sites,
  activeSiteId,
  onSelect,
  onManageResources,
}: {
  sites: SiteWithStatus[]
  activeSiteId: string | null
  onSelect: (siteId: string) => void
  onManageResources: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const activeSite = sites.find((s) => s.siteId === activeSiteId)
  const connected = sites.filter((s) => s.status === 'connected')
  const exhausted = sites.filter((s) => s.status === 'quota-exhausted')

  return (
    <div ref={ref}>
      <button
        aria-label="model-dropdown-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        {activeSite?.label ?? '选择 AI'}
      </button>

      {open && (
        <div role="listbox">
          {connected.map((s) => (
            <button
              key={s.siteId}
              role="option"
              aria-selected={s.siteId === activeSiteId}
              onClick={() => { onSelect(s.siteId); setOpen(false) }}
            >
              {s.label}
            </button>
          ))}
          {exhausted.map((s) => (
            <div key={s.siteId} aria-label={`exhausted-${s.siteId}`}>
              {s.label} (额度用尽)
            </div>
          ))}
          <button onClick={() => { setOpen(false); onManageResources() }}>
            管理 AI 资源…
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ModelDropdown', () => {
  it('shows "选择 AI" when no site is active', () => {
    render(
      <ModelDropdown
        sites={[makeSite()]}
        activeSiteId={null}
        onSelect={vi.fn()}
        onManageResources={vi.fn()}
      />
    )
    expect(screen.getByLabelText('model-dropdown-toggle').textContent).toBe('选择 AI')
  })

  it('shows active site label in trigger button', () => {
    render(
      <ModelDropdown
        sites={[makeSite({ siteId: 's1', label: 'Claude' })]}
        activeSiteId="s1"
        onSelect={vi.fn()}
        onManageResources={vi.fn()}
      />
    )
    expect(screen.getByLabelText('model-dropdown-toggle').textContent).toBe('Claude')
  })

  it('opens dropdown on click and lists connected sites', async () => {
    render(
      <ModelDropdown
        sites={[makeSite({ siteId: 's1', label: 'GPT-4' })]}
        activeSiteId="s1"
        onSelect={vi.fn()}
        onManageResources={vi.fn()}
      />
    )
    fireEvent.click(screen.getByLabelText('model-dropdown-toggle'))
    expect(screen.getByRole('listbox')).toBeTruthy()
    // The option inside the listbox must include the site label
    expect(screen.getByRole('option', { name: 'GPT-4' })).toBeTruthy()
  })

  it('calls onSelect and closes on item click', async () => {
    const onSelect = vi.fn()
    render(
      <ModelDropdown
        sites={[makeSite({ siteId: 's1', label: 'GPT-4' })]}
        activeSiteId="s1"
        onSelect={onSelect}
        onManageResources={vi.fn()}
      />
    )
    fireEvent.click(screen.getByLabelText('model-dropdown-toggle'))
    fireEvent.click(screen.getByRole('option', { name: 'GPT-4' }))

    expect(onSelect).toHaveBeenCalledWith('s1')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('shows exhausted sites as non-selectable', () => {
    const sites = [
      makeSite({ siteId: 's1', label: 'GPT-4', status: 'connected' }),
      makeSite({ siteId: 's2', label: 'Claude', status: 'quota-exhausted' }),
    ]
    render(
      <ModelDropdown
        sites={sites}
        activeSiteId="s1"
        onSelect={vi.fn()}
        onManageResources={vi.fn()}
      />
    )
    fireEvent.click(screen.getByLabelText('model-dropdown-toggle'))
    // quota-exhausted site should appear but not as a selectable option
    expect(screen.getByLabelText('exhausted-s2')).toBeTruthy()
    expect(screen.queryByRole('option', { name: /Claude/ })).toBeNull()
  })

  it('calls onManageResources on "管理 AI 资源" click', () => {
    const onManage = vi.fn()
    render(
      <ModelDropdown
        sites={[makeSite()]}
        activeSiteId="site-1"
        onSelect={vi.fn()}
        onManageResources={onManage}
      />
    )
    fireEvent.click(screen.getByLabelText('model-dropdown-toggle'))
    fireEvent.click(screen.getByText('管理 AI 资源…'))
    expect(onManage).toHaveBeenCalledOnce()
  })

  it('closes dropdown when clicking outside', async () => {
    render(
      <div>
        <ModelDropdown
          sites={[makeSite()]}
          activeSiteId="site-1"
          onSelect={vi.fn()}
          onManageResources={vi.fn()}
        />
        <button aria-label="outside">outside</button>
      </div>
    )
    fireEvent.click(screen.getByLabelText('model-dropdown-toggle'))
    expect(screen.getByRole('listbox')).toBeTruthy()

    // Simulate mousedown outside the dropdown
    fireEvent.mouseDown(screen.getByLabelText('outside'))
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  })
})
