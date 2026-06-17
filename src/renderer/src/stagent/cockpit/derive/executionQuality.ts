import type { QualityReportPayload } from '@stagent/core'

export type ExecutionQualityTone = 'neutral' | 'good' | 'warn' | 'bad'

export interface ExecutionQualitySummary {
  tone: ExecutionQualityTone
  /** 横条主文案(一行)。 */
  label: string
  /** 可选副文案。 */
  detail?: string
}

/** 由执行期 qualityReport 派生常驻质量条文案;无报告时中性占位。纯函数。 */
export function deriveExecutionQuality(report?: QualityReportPayload | null): ExecutionQualitySummary {
  if (!report) {
    return { tone: 'neutral', label: '质量 · 执行中,测试报告尚未生成' }
  }

  const testTotal = report.verificationRows.reduce((n, r) => n + r.totalRuns, 0)
  const testPass = report.verificationRows.reduce((n, r) => n + r.passCount, 0)
  const afk = report.afk.passed

  if (testTotal === 0) {
    if (afk === false) {
      return {
        tone: 'bad',
        label: '质量 · AFK 检查未通过',
        detail: report.afk.reasons[0],
      }
    }
    if (afk === true) {
      return { tone: 'good', label: '质量 · AFK 检查已通过', detail: '尚无逐阶段测试数据' }
    }
    return { tone: 'neutral', label: '质量 · 尚无逐阶段测试', detail: 'AFK 结果待更新' }
  }

  const testsOk = testPass >= testTotal
  if (afk === false || !testsOk) {
    return {
      tone: 'bad',
      label: `质量 · 测试 ${testPass}/${testTotal} 通过`,
      detail: afk === false ? 'AFK 检查未通过' : '部分测试未通过',
    }
  }

  return {
    tone: 'good',
    label: `质量 · 测试 ${testPass}/${testTotal} 通过`,
    detail: afk === true ? 'AFK 检查已通过' : undefined,
  }
}
