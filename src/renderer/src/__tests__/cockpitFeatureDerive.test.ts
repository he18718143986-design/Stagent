import { describe, it, expect } from 'vitest'
import type { Stage, QualityReportPayload, StageStatus } from '@stagent/core'
import {
  deriveExecutionActivity,
  pickExecutionStart,
  formatElapsed,
} from '../stagent/cockpit/derive/executionActivity'
import { buildPlanProposal } from '../stagent/cockpit/derive/planProposal'
import { buildAcceptanceReport } from '../stagent/cockpit/derive/acceptanceReport'
import { buildRetrospective } from '../stagent/cockpit/derive/retrospective'
import { deriveExecutionQuality } from '../stagent/cockpit/derive/executionQuality'

const baseActivity = {
  stages: [
    { id: 'stage_impl_a', title: '实现 A' },
    { id: 'stage_impl_b', title: '实现 B' },
  ],
  stageStatus: {} as Record<string, StageStatus>,
  questionsBefore: {},
  questions: {},
  engineActivityFeed: [] as { kind: string; text: string }[],
}

describe('deriveExecutionActivity', () => {
  it('waiting-you when a gate is active', () => {
    expect(deriveExecutionActivity({ ...baseActivity, decisionStageId: 'x' }).state).toBe('waiting-you')
    expect(
      deriveExecutionActivity({ ...baseActivity, questions: { s: [{}] } }).state,
    ).toBe('waiting-you')
  })
  it('self-heal when a stage is retrying (attempts >= 1)', () => {
    const a = deriveExecutionActivity({
      ...baseActivity,
      stageStatus: { stage_impl_a: 'retrying' } as Record<string, StageStatus>,
      engineActivityFeed: [{ kind: 'runtime_replan', text: 'x' }],
    })
    expect(a.state).toBe('self-heal')
    expect(a.currentTitle).toBe('实现 A')
    expect(a.selfHealAttempts).toBe(1)
  })
  it('working when a stage is running', () => {
    const a = deriveExecutionActivity({ ...baseActivity, stageStatus: { stage_impl_b: 'running' } as Record<string, StageStatus> })
    expect(a.state).toBe('working')
    expect(a.currentTitle).toBe('实现 B')
  })
  it('wrapping otherwise', () => {
    expect(deriveExecutionActivity(baseActivity).state).toBe('wrapping')
  })
})

describe('pickExecutionStart / formatElapsed', () => {
  it('picks earliest feed timestamp, falls back to mount time', () => {
    expect(pickExecutionStart([], 1000)).toBe(1000)
    const t = pickExecutionStart(
      [{ timestamp: '2026-01-01T00:00:10Z' }, { timestamp: '2026-01-01T00:00:05Z' }],
      9_999_999_999_999,
    )
    expect(t).toBe(Date.parse('2026-01-01T00:00:05Z'))
  })
  it('formats elapsed', () => {
    expect(formatElapsed(0)).toBe('0秒')
    expect(formatElapsed(45_000)).toBe('45秒')
    expect(formatElapsed(125_000)).toBe('2分05秒')
  })
})

function stage(id: string, title: string, extra: Partial<Stage> = {}): Stage {
  return {
    id,
    title,
    tool: 'llm-text',
    toolConfig: { type: 'llm-text', systemPrompt: 'x' },
    input: { sources: [], mergeStrategy: 'concat' },
    outputs: [],
    pauseAfter: false,
    ...extra,
  }
}

describe('buildPlanProposal', () => {
  it('pairs impl stages with their test_run and counts coverage', () => {
    const stages = [
      stage('stage_decide_x', '决策', { isDecisionStage: true }),
      stage('stage_impl_login', '实现登录', { description: '解析并校验登录' }),
      stage('stage_test_run_login', '测试登录'),
      stage('stage_impl_pay', '实现支付'),
      stage('stage_test_run_other', 'venv'), // engine-inserted-ish stays a test_run, excluded from rows
    ]
    const p = buildPlanProposal(stages)
    const ids = p.rows.map((r) => r.id)
    expect(ids).toContain('stage_impl_login')
    expect(ids).toContain('stage_impl_pay')
    expect(ids).not.toContain('stage_test_run_login')
    const login = p.rows.find((r) => r.id === 'stage_impl_login')!
    expect(login.purpose).toBe('解析并校验登录')
    expect(login.verification).toBe('测试登录')
    const pay = p.rows.find((r) => r.id === 'stage_impl_pay')!
    expect(pay.verification).toBeNull()
    expect(p.verifiedCount).toBe(1)
  })
})

const qr = (passed: boolean, pass: number, total: number, reasons: string[] = []): QualityReportPayload =>
  ({
    afk: {
      passed,
      stableVerificationPasses: pass,
      verificationStages: total,
      humanInterventions: 0,
      runtimeReplanCount: 0,
      dodDeliverablesSatisfied: 0,
      dodDeliverablesTotal: 0,
      charterCoverageRate: 1,
      flakyStages: [],
      dodConfigured: false,
      reasons,
    },
    verificationRows: [{ stageId: 's', passCount: pass, totalRuns: total, stable: passed, flaky: false }],
    engineSummary: '',
  }) as unknown as QualityReportPayload

describe('buildAcceptanceReport', () => {
  it('splits requirements and maps overall pass/fail/unknown', () => {
    expect(buildAcceptanceReport({ userInput: 'A。B；C' }).requirements).toEqual(['A', 'B', 'C'])
    expect(buildAcceptanceReport({ userInput: 'x', qualityReport: qr(true, 2, 2) }).overall).toBe('pass')
    const fail = buildAcceptanceReport({ userInput: 'x', qualityReport: qr(false, 0, 1, ['测试失败']) })
    expect(fail.overall).toBe('fail')
    expect(fail.knownIssues).toEqual(['测试失败'])
    expect(buildAcceptanceReport({ userInput: 'x' }).overall).toBe('unknown')
  })
})

describe('buildRetrospective', () => {
  it('counts decisions, tests passed, self-heals; lists key decisions', () => {
    const stages = [
      stage('dec1', '架构决策', { isDecisionStage: true }),
      stage('stage_impl_a', 'A'),
      stage('dec2', '依赖决策', { isDecisionStage: true }),
    ]
    const info = buildRetrospective({
      stages,
      qualityReport: qr(true, 5, 5),
      engineActivityFeed: [
        { kind: 'runtime_replan', text: 'x' },
        { kind: 'info', text: '触发重试' },
      ],
    })
    expect(info.decisions).toBe(2)
    expect(info.stages).toBe(3)
    expect(info.testsPassed).toBe(5)
    expect(info.selfHeals).toBe(2)
    expect(info.keyDecisions).toEqual(['架构决策', '依赖决策'])
  })
})

describe('deriveExecutionQuality', () => {
  it('neutral when no report', () => {
    expect(deriveExecutionQuality(null).tone).toBe('neutral')
  })
  it('good when all tests pass and afk ok', () => {
    const q = deriveExecutionQuality(qr(true, 3, 3))
    expect(q.tone).toBe('good')
    expect(q.label).toMatch(/3\/3/)
  })
  it('bad when tests incomplete or afk failed', () => {
    expect(deriveExecutionQuality(qr(false, 1, 3)).tone).toBe('bad')
    expect(deriveExecutionQuality(qr(true, 1, 3)).tone).toBe('bad')
  })
  it('does not show misleading 0/0 when report exists but no test runs yet', () => {
    const q = deriveExecutionQuality({
      ...qr(true, 0, 0),
      verificationRows: [],
    })
    expect(q.tone).toBe('good')
    expect(q.label).not.toMatch(/0\/0/)
    expect(q.label).toMatch(/尚无逐阶段测试|AFK/)
  })
})
