import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DecisionReview } from '../stagent/cockpit/components/DecisionReview'

const RECORD = '### 职责边界\n仅做加法\n\n### 关键设计决策\n用 sys.argv'

describe('DecisionReview prefill', () => {
  it('prefills the textarea with the LLM-generated decision record', () => {
    render(
      <DecisionReview
        stageId="dec"
        initialRecord={RECORD}
        onApprove={vi.fn()}
        onReview={vi.fn(async () => ({ ok: true }))}
      />,
    )
    const ta = screen.getByPlaceholderText(/记录此处所做的关键决策/) as HTMLTextAreaElement
    expect(ta.value).toBe(RECORD)
    // approve becomes enabled because the prefilled record is non-empty
    expect((screen.getByRole('button', { name: /批准决策并继续/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('stays empty when no record is provided', () => {
    render(<DecisionReview stageId="dec" onApprove={vi.fn()} onReview={vi.fn(async () => ({ ok: true }))} />)
    const ta = screen.getByPlaceholderText(/记录此处所做的关键决策/) as HTMLTextAreaElement
    expect(ta.value).toBe('')
  })
})
