import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PillOptionGroup, inferRecommendedOption } from '../stagent/cockpit/components/PillOptionGroup'

describe('inferRecommendedOption', () => {
  it('returns undefined for empty/missing options', () => {
    expect(inferRecommendedOption(undefined)).toBeUndefined()
    expect(inferRecommendedOption([])).toBeUndefined()
  })

  it('falls back to the first option when nothing is marked', () => {
    expect(inferRecommendedOption(['A', 'B'])).toBe('A')
  })

  it('picks a marked option across varied markers (case-insensitive)', () => {
    expect(inferRecommendedOption(['A', 'B（推荐）'])).toBe('B（推荐）')
    expect(inferRecommendedOption(['A', 'B 建议'])).toBe('B 建议')
    expect(inferRecommendedOption(['A', '★ B'])).toBe('★ B')
    expect(inferRecommendedOption(['A', 'B (Recommended)'])).toBe('B (Recommended)')
    expect(inferRecommendedOption(['A', 'B [default]'])).toBe('B [default]')
  })
})

describe('PillOptionGroup', () => {
  it('highlights recommended option', () => {
    const onChange = vi.fn()
    render(
      <PillOptionGroup
        question={{
          id: 'q1',
          text: '选哪个？',
          options: ['A', 'B'],
          recommendedOption: 'B',
        }}
        value="B"
        onChange={onChange}
      />,
    )
    expect(screen.getByText('推荐')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /A/ }))
    expect(onChange).toHaveBeenCalledWith('A')
  })
})
