import { describe, it, expect } from 'vitest'
import { decideToggleAction } from './tool-toggle'

describe('decideToggleAction', () => {
  it('pure flip (no desired state) always clicks', () => {
    expect(decideToggleAction(true)).toBe('click')
    expect(decideToggleAction(false)).toBe('click')
    expect(decideToggleAction(null)).toBe('click')
  })

  it('known state clicks only when it differs from desired', () => {
    expect(decideToggleAction(false, true)).toBe('click')   // off → enable
    expect(decideToggleAction(true, true)).toBe('skip')     // already on
    expect(decideToggleAction(true, false)).toBe('click')   // on → disable
    expect(decideToggleAction(false, false)).toBe('skip')   // already off
  })

  it('unknown state only clicks to enable (cannot verify a disable)', () => {
    expect(decideToggleAction(null, true)).toBe('click')
    expect(decideToggleAction(null, false)).toBe('skip')
  })
})
