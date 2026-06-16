import type { QualityReportPayload } from '@stagent/core'

export interface AcceptanceReport {
  requirements: string[]
  overall: 'pass' | 'fail' | 'unknown'
  knownIssues: string[]
  nextSteps: string[]
}

/**
 * 验收报告:需求清单 + 整体验证结论 + 已知问题 + 下一步。纯函数。
 * 诚实边界:需求与测试无 1:1 关联,故只给整体结论 + 需求清单,不编造矩阵。
 */
export function buildAcceptanceReport(args: {
  userInput: string
  qualityReport?: QualityReportPayload | null
}): AcceptanceReport {
  const requirements = (args.userInput ?? '')
    .split(/[。；\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6)
  const r = args.qualityReport
  const overall: AcceptanceReport['overall'] = !r ? 'unknown' : r.afk.passed ? 'pass' : 'fail'
  const knownIssues = r?.afk.reasons ?? []
  const nextSteps =
    overall === 'fail'
      ? ['查看下方未通过项,在对应阶段「重试」或手动修正', '确认关键功能可用后再正式使用']
      : overall === 'pass'
        ? ['可以直接使用;如需改动,回首页继续提需求']
        : ['暂无质量报告,建议手动核对关键功能后再使用']
  return { requirements, overall, knownIssues, nextSteps }
}
