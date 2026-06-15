import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgressRing } from '../stagent/cockpit/components/ProgressRing'
import { CredibilityStrip } from '../stagent/cockpit/components/CredibilityStrip'
import { MiniDag } from '../stagent/cockpit/components/MiniDag'
import type { StageConfidence } from '../stagent/useStagentEngine'

describe('ProgressRing', () => {
  it('clamps and renders percent with progressbar role', () => {
    render(<ProgressRing percent={150} />)
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('100')
    expect(screen.getByText('100%')).toBeTruthy()
  })

  it('clamps negative to 0', () => {
    render(<ProgressRing percent={-20} />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0')
  })
})

describe('CredibilityStrip', () => {
  it('shows neutral placeholder when empty', () => {
    render(<CredibilityStrip confidence={{}} />)
    expect(screen.getByText(/尚无数据/)).toBeTruthy()
  })

  it('shows worst level label when data present', () => {
    const confidence: Record<string, StageConfidence> = {
      a: { score: 0.9, level: 'high', reasons: [] },
      b: { score: 0.3, level: 'critical', reasons: ['x'] },
    }
    render(<CredibilityStrip confidence={confidence} />)
    expect(screen.getByText(/可信度 严重偏低/)).toBeTruthy()
    expect(screen.getByText(/均值 60%/)).toBeTruthy()
  })
})

describe('MiniDag', () => {
  it('renders a node per stage with role tag', () => {
    render(
      <MiniDag
        stages={[
          { id: 'stage_impl_a', title: '实现登录' },
          { id: 'dec', title: '架构决策', isDecisionStage: true },
        ]}
        stageStatus={{ stage_impl_a: 'done' }}
      />,
    )
    expect(screen.getByText('实现登录')).toBeTruthy()
    expect(screen.getByText('架构决策')).toBeTruthy()
    expect(screen.getByText('决策')).toBeTruthy()
  })

  it('renders empty placeholder', () => {
    render(<MiniDag stages={[]} stageStatus={{}} />)
    expect(screen.getByText('暂无阶段')).toBeTruthy()
  })
})
