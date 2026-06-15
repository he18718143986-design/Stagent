import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PillOptionGroup } from '../stagent/cockpit/components/PillOptionGroup'

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
