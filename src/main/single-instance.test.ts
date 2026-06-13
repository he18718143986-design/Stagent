import { describe, it, expect } from 'vitest'
import { focusExistingWindow, type FocusableWindow } from './single-instance'

/** Records which window methods were called, with configurable state. */
function fakeWindow(state: { destroyed?: boolean; minimized?: boolean }): FocusableWindow & {
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    isDestroyed: () => !!state.destroyed,
    isMinimized: () => !!state.minimized,
    restore: () => void calls.push('restore'),
    show: () => void calls.push('show'),
    focus: () => void calls.push('focus'),
  }
}

describe('focusExistingWindow', () => {
  it('returns false for a missing window', () => {
    expect(focusExistingWindow(null)).toBe(false)
    expect(focusExistingWindow(undefined)).toBe(false)
  })

  it('returns false (and does nothing) for a destroyed window', () => {
    const win = fakeWindow({ destroyed: true })
    expect(focusExistingWindow(win)).toBe(false)
    expect(win.calls).toEqual([])
  })

  it('shows and focuses a normal window without restoring', () => {
    const win = fakeWindow({ minimized: false })
    expect(focusExistingWindow(win)).toBe(true)
    expect(win.calls).toEqual(['show', 'focus'])
  })

  it('restores a minimized window before showing + focusing', () => {
    const win = fakeWindow({ minimized: true })
    expect(focusExistingWindow(win)).toBe(true)
    expect(win.calls).toEqual(['restore', 'show', 'focus'])
  })
})
