import { describe, it, expect } from 'vitest'
import {
  clampSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from '../pages/useSidebarLayout'

describe('clampSidebarWidth', () => {
  it('clamps to 240–480', () => {
    expect(clampSidebarWidth(100)).toBe(SIDEBAR_WIDTH_MIN)
    expect(clampSidebarWidth(240)).toBe(240)
    expect(clampSidebarWidth(288)).toBe(288)
    expect(clampSidebarWidth(480)).toBe(480)
    expect(clampSidebarWidth(999)).toBe(SIDEBAR_WIDTH_MAX)
  })

  it('returns default for non-finite values', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_WIDTH_DEFAULT)
  })
})
