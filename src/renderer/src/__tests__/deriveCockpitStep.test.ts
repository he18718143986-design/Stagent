import { describe, it, expect } from 'vitest'
import { deriveStep } from '../stagent/cockpit/deriveCockpitStep'
import { initialStagentState, type StagentState } from '../stagent/useStagentEngine'

describe('deriveStep (unified)', () => {
  it('step 1 on fresh input', () => {
    expect(deriveStep(initialStagentState)).toBe(1)
  })

  it('step 2 when clarify present', () => {
    const s: StagentState = { ...initialStagentState, clarify: [{ id: 'q1', text: 'test?' }] }
    expect(deriveStep(s)).toBe(2)
  })

  it('step 2 while generating', () => {
    const s: StagentState = { ...initialStagentState, busy: { message: '生成工作流…' } }
    expect(deriveStep(s)).toBe(2)
  })

  it('step 3 on confirm', () => {
    const s = { ...initialStagentState, phase: 'confirm' } as StagentState
    expect(deriveStep(s)).toBe(3)
  })

  it('step 4 on execution', () => {
    const s: StagentState = { ...initialStagentState, phase: 'execution', completed: false }
    expect(deriveStep(s)).toBe(4)
  })

  it('step 5 when completed', () => {
    const s: StagentState = { ...initialStagentState, phase: 'execution', completed: true }
    expect(deriveStep(s)).toBe(5)
  })
})
