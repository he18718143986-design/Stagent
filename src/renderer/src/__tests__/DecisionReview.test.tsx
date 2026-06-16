import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

const RECORD_WITH_ASSUMPTION = '### 关键设计决策\n用 sys.argv\n### AI 无法验证的假设\n- 已安装 Python 3'

describe('DecisionReview force-judgment gates', () => {
  it('blocks approval until each AI-unverifiable assumption is acknowledged', () => {
    render(
      <DecisionReview
        stageId="dec"
        initialRecord={RECORD_WITH_ASSUMPTION}
        onApprove={vi.fn()}
        onReview={vi.fn(async () => ({ ok: true }))}
      />,
    )
    expect(screen.getByText(/批准前请逐条知悉/)).toBeTruthy()
    const approve = screen.getByRole('button', { name: /批准决策并继续/ }) as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(approve.disabled).toBe(false)
  })

  it('requires a second confirm when the structure self-check is incomplete', () => {
    const onApprove = vi.fn()
    render(
      <DecisionReview
        stageId="dec"
        initialRecord={RECORD_WITH_ASSUMPTION}
        onApprove={onApprove}
        onReview={vi.fn(async () => ({ ok: true }))}
      />,
    )
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /批准决策并继续/ }))
    // first click surfaces the confirm, does NOT approve yet
    expect(onApprove).not.toHaveBeenCalled()
    expect(screen.getByText(/仍要批准吗/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /仍要批准/ }))
    expect(onApprove).toHaveBeenCalledTimes(1)
  })
})
