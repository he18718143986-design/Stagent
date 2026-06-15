import { describe, it, expect } from 'vitest'
import { deriveSimpleStep, deriveProStep } from '../stagent/cockpit/deriveCockpitStep'
import { initialStagentState, type StagentState } from '../stagent/useStagentEngine'

describe('deriveCockpitStep', () => {
  it('simple step 1 on fresh input', () => {
    expect(deriveSimpleStep(initialStagentState)).toBe(1)
  })

  it('simple step 2 when clarify present', () => {
    const s: StagentState = {
      ...initialStagentState,
      clarify: [{ id: 'q1', text: 'test?' }],
    }
    expect(deriveSimpleStep(s)).toBe(2)
  })

  it('simple step 2 on confirm', () => {
    const s = {
      ...initialStagentState,
      phase: 'confirm',
      workflow: { meta: { title: 't' }, stages: [] },
    } as unknown as StagentState
    expect(deriveSimpleStep(s)).toBe(2)
  })

  it('simple step 3 on execution', () => {
    const s: StagentState = {
      ...initialStagentState,
      phase: 'execution',
      completed: false,
    }
    expect(deriveSimpleStep(s)).toBe(3)
  })

  it('simple step 4 when completed', () => {
    const s: StagentState = {
      ...initialStagentState,
      phase: 'execution',
      completed: true,
    }
    expect(deriveSimpleStep(s)).toBe(4)
  })

  it('pro step 0 on input', () => {
    expect(deriveProStep(initialStagentState)).toBe(0)
  })

  it('pro step 5 when completed', () => {
    const s: StagentState = {
      ...initialStagentState,
      phase: 'execution',
      completed: true,
    }
    expect(deriveProStep(s)).toBe(5)
  })
})
