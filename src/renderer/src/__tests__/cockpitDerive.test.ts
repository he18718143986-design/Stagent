import { describe, it, expect } from 'vitest'
import type { StageStatus } from '@stagent/core'
import { deriveProgress } from '../stagent/cockpit/derive/progress'
import { deriveCredibility } from '../stagent/cockpit/derive/credibility'
import { deriveMiniDag, stageRole } from '../stagent/cockpit/derive/dag'
import type { StageConfidence } from '../stagent/useStagentEngine'

const steps = [
  { id: 'a', title: 'A' },
  { id: 'b', title: 'B' },
  { id: 'c', title: 'C' },
  { id: 'd', title: 'D' },
]

describe('deriveProgress', () => {
  it('empty steps → 0%', () => {
    const p = deriveProgress([], {})
    expect(p).toEqual({ total: 0, done: 0, percent: 0, currentStageId: null, currentTitle: null })
  })

  it('counts done + skipped and rounds percent', () => {
    const status: Record<string, StageStatus> = { a: 'done', b: 'skipped', c: 'pending', d: 'pending' }
    const p = deriveProgress(steps, status)
    expect(p.done).toBe(2)
    expect(p.total).toBe(4)
    expect(p.percent).toBe(50)
  })

  it('current = first active stage, falls back to first pending', () => {
    const active = deriveProgress(steps, { a: 'done', b: 'running', c: 'pending', d: 'pending' })
    expect(active.currentStageId).toBe('b')
    const pendingOnly = deriveProgress(steps, { a: 'done' })
    expect(pendingOnly.currentStageId).toBe('b')
    expect(pendingOnly.currentTitle).toBe('B')
  })

  it('all done → 100% and no current', () => {
    const p = deriveProgress(steps, { a: 'done', b: 'done', c: 'done', d: 'done' })
    expect(p.percent).toBe(100)
    expect(p.currentStageId).toBeNull()
  })

  it('rounds non-integer percent', () => {
    const p = deriveProgress(steps.slice(0, 3), { a: 'done' })
    expect(p.percent).toBe(33)
  })
})

function conf(score: number, level: StageConfidence['level'], reasons: string[] = []): StageConfidence {
  return { score, level, reasons }
}

describe('deriveCredibility', () => {
  it('empty → neutral state', () => {
    const c = deriveCredibility({})
    expect(c.state).toBe('empty')
    expect(c.count).toBe(0)
    expect(c.overallLevel).toBeNull()
    expect(c.averagePercent).toBe(0)
  })

  it('averages scores to percent and counts levels', () => {
    const c = deriveCredibility({ a: conf(0.9, 'high'), b: conf(0.7, 'medium') })
    expect(c.state).toBe('ready')
    expect(c.count).toBe(2)
    expect(c.averagePercent).toBe(80)
    expect(c.counts.high).toBe(1)
    expect(c.counts.medium).toBe(1)
  })

  it('overall level is the worst present (critical drags down high)', () => {
    const c = deriveCredibility({
      a: conf(0.95, 'high'),
      b: conf(0.2, 'critical', ['缺少测试覆盖']),
    })
    expect(c.overallLevel).toBe('critical')
    expect(c.lowestReasons).toEqual(['缺少测试覆盖'])
  })

  it('low beats medium/high but not critical', () => {
    expect(deriveCredibility({ a: conf(0.5, 'medium'), b: conf(0.4, 'low') }).overallLevel).toBe('low')
  })
})

describe('stageRole / deriveMiniDag', () => {
  it('classifies roles by id and decision flag', () => {
    expect(stageRole('x', true)).toBe('decision')
    expect(stageRole('stage_impl_foo')).toBe('impl')
    expect(stageRole('stage_test_run_foo')).toBe('test')
    expect(stageRole('integration_main')).toBe('integration')
    expect(stageRole('stage_misc')).toBe('other')
  })

  it('decision flag wins over id pattern', () => {
    expect(stageRole('stage_impl_foo', true)).toBe('decision')
  })

  it('maps stages to nodes with status default pending', () => {
    const nodes = deriveMiniDag(
      [
        { id: 'stage_impl_a', title: 'A' },
        { id: 'dec', title: 'D', isDecisionStage: true },
      ],
      { stage_impl_a: 'done' },
    )
    expect(nodes).toEqual([
      { id: 'stage_impl_a', title: 'A', role: 'impl', status: 'done' },
      { id: 'dec', title: 'D', role: 'decision', status: 'pending' },
    ])
  })
})
