import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CockpitProvider, useCockpitContext } from '../stagent/cockpit/CockpitContext'
import { TechnicalDetailsCollapsible } from '../stagent/cockpit/components/TechnicalDetailsCollapsible'

function Harness(): React.JSX.Element {
  const { showTechnical, setShowTechnical } = useCockpitContext()
  return (
    <>
      <button type="button" onClick={() => setShowTechnical(!showTechnical)}>
        toggle
      </button>
      <TechnicalDetailsCollapsible title="T">
        <div>secret-body</div>
      </TechnicalDetailsCollapsible>
    </>
  )
}

describe('TechnicalDetailsCollapsible density coupling', () => {
  it('auto-expands when showTechnical flips on, and collapses back', () => {
    try {
      localStorage.clear()
    } catch {
      /* ignore */
    }
    render(
      <CockpitProvider>
        <Harness />
      </CockpitProvider>,
    )
    // default density false → collapsed
    expect(screen.queryByText('secret-body')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }))
    expect(screen.getByText('secret-body')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }))
    expect(screen.queryByText('secret-body')).toBeNull()
  })
})
