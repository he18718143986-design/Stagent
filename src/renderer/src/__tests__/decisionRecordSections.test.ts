import { describe, it, expect } from 'vitest'
import { extractDecisionAssumptions } from '../stagent/cockpit/derive/decisionRecordSections'

describe('extractDecisionAssumptions', () => {
  it('returns [] when section/text missing', () => {
    expect(extractDecisionAssumptions('')).toEqual([])
    expect(extractDecisionAssumptions('### 职责边界\n只做加法')).toEqual([])
  })

  it('extracts bullets under the AI-unverifiable-assumptions heading only', () => {
    const text = [
      '### 关键设计决策',
      '- 用 sys.argv',
      '### AI 无法验证的假设',
      '- 假设1：用户已安装 Python 3',
      '* 用户用 UTF-8 终端',
      '### 边界压力测试',
      '- 非数字报错',
    ].join('\n')
    expect(extractDecisionAssumptions(text)).toEqual([
      '用户已安装 Python 3',
      '用户用 UTF-8 终端',
    ])
  })

  it('caps the number of items', () => {
    const lines = ['### AI 无法验证的假设', ...Array.from({ length: 12 }, (_, i) => `- a${i}`)]
    expect(extractDecisionAssumptions(lines.join('\n'), 8)).toHaveLength(8)
  })
})
