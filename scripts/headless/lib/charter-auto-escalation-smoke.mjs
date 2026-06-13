/**
 * PR-2 acceptance: auto-with-escalation silent prefill for non-ADR + Gate 1 HITL for ADR.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { WorkflowEngine } from '@stagent/core'
import { createHeadlessPlatform } from './headless-platform.mjs'
import { MOCK_MODEL_ID } from './mock-llm-server.mjs'

const CHARTER_REL = 'docs/agents/charter.md'
const CHARTER_MD = `## 避免（Avoid）
- 避免为减文件数而合并 unrelated seam
## 约束（Constraints）
- 必须支持 node 18 运行时`

const STAGE_ID = 'stage_impl_charter_auto_smoke'

const SMOKE_WORKFLOW = {
  id: 'wf_charter_auto_smoke',
  version: '2.0',
  meta: {
    title: 'Charter auto-with-escalation smoke',
    taskType: 'prototype',
    userInput: 'PR-2 charter auto-with-escalation headless smoke',
    createdAt: new Date().toISOString(),
  },
  stages: [
    {
      id: STAGE_ID,
      title: 'Charter auto grill smoke',
      meta: { executionMode: 'deterministic' },
      tool: 'llm-text',
      toolConfig: {
        type: 'llm-text',
        systemPrompt: 'MOCK_STAGE:charter_smoke 只回复 smoke-ok，不要其它内容。',
      },
      input: { sources: [{ type: 'user-input', label: '任务' }], mergeStrategy: 'concat' },
      outputs: [{ key: 'code', format: 'text' }],
      pauseAfter: false,
      questionBefore: [
        {
          id: 'q_seam',
          text: '是否应该合并 unrelated seam 来减文件数？',
          required: true,
        },
        {
          id: 'q_adr',
          text: 'MarketGateway 是否应该设计为 abstract base class 还是 Protocol？',
          required: true,
        },
      ],
    },
  ],
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function msgType(m) {
  return typeof m === 'object' && m !== null && 'type' in m ? String(m.type) : 'unknown'
}

async function drainHitl(engine, sent, handled) {
  for (const m of sent) {
    if (typeof m !== 'object' || m === null || !('type' in m)) continue
    if (m.type !== 'stageQuestionsBefore') continue
    if (handled.has(m)) continue
    handled.add(m)
    const stageId = 'stageId' in m ? String(m.stageId) : ''
    const questions = 'questions' in m && Array.isArray(m.questions) ? m.questions : []
    const answers = {}
    for (const q of questions) {
      if (typeof q !== 'object' || q === null || !('id' in q)) continue
      const id = String(q.id)
      if (id === 'q_seam') {
        continue
      }
      answers[id] = 'headless-adr-answer'
    }
    await engine.answerQuestionsBefore(stageId, answers)
  }
}

function assertAutoEscalationMessages(sent) {
  const qb = sent.find(
    (m) =>
      msgType(m) === 'stageQuestionsBefore' &&
      typeof m === 'object' &&
      m !== null &&
      m.stageId === STAGE_ID,
  )
  if (!qb || !Array.isArray(qb.questions)) {
    throw new Error('missing stageQuestionsBefore for ADR halt')
  }
  const ids = qb.questions.map((q) => (q && typeof q === 'object' && 'id' in q ? String(q.id) : ''))
  if (!ids.includes('q_adr')) {
    throw new Error(`stageQuestionsBefore missing q_adr, got: ${ids.join(',')}`)
  }
  const hitlCount = sent.filter((m) => msgType(m) === 'stageQuestionsBefore').length
  if (hitlCount !== 1) {
    throw new Error(`expected exactly 1 stageQuestionsBefore, got ${hitlCount}`)
  }
}

/**
 * @param {{ mockUrl?: string, liveLlm?: { apiKey: string, baseUrl: string, model: string, maxOutputTokens?: number }, keep?: boolean, workspace?: string }} ctx
 */
export async function runCharterAutoEscalationSmoke(ctx) {
  const started = Date.now()
  const sent = []
  const base = ctx.workspace
    ? path.dirname(path.resolve(ctx.workspace))
    : fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-charter-auto-'))
  const ws = ctx.workspace ? path.resolve(ctx.workspace) : path.join(base, 'task')
  fs.mkdirSync(ws, { recursive: true })

  const charterDir = path.join(ws, path.dirname(CHARTER_REL))
  fs.mkdirSync(charterDir, { recursive: true })
  fs.writeFileSync(path.join(ws, CHARTER_REL), CHARTER_MD, 'utf8')

  const globalDir = path.join(base, 'global')
  const llm = ctx.liveLlm ?? {
    apiKey: 'mock-key',
    baseUrl: `${ctx.mockUrl}/v1`,
    model: MOCK_MODEL_ID,
    maxOutputTokens: 1024,
  }
  if (!ctx.liveLlm && !ctx.mockUrl) {
    throw new Error('charter-auto smoke requires mockUrl or liveLlm')
  }

  const platform = createHeadlessPlatform({
    workspace: ws,
    globalDir,
    llm,
    configOverrides: {
      'charter.enabled': true,
      'charter.autoAnswerMode': 'auto-with-escalation',
      'charter.path': CHARTER_REL,
      'grill.adaptiveMode': false,
    },
    onMessage: (m) => sent.push(m),
  })

  const engine = new WorkflowEngine(platform)
  engine.setPreferredModelFamily(`direct:${llm.model}`)

  const workflow = {
    ...SMOKE_WORKFLOW,
    meta: { ...SMOKE_WORKFLOW.meta, taskWorkspacePath: ws },
  }

  await engine.startExecution(workflow)

  const handled = new Set()
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    await drainHitl(engine, sent, handled)
    const terminal = sent.find((m) => {
      const t = msgType(m)
      return t === 'workflowCompleted' || t === 'workflowFailed'
    })
    if (terminal) {
      if (msgType(terminal) !== 'workflowCompleted') {
        const reason =
          typeof terminal === 'object' && terminal !== null && 'reason' in terminal
            ? String(terminal.reason)
            : msgType(terminal)
        throw new Error(`workflow ended with ${msgType(terminal)}: ${reason}`)
      }
      assertAutoEscalationMessages(sent)
      const summaries = engine.getTaskSummaries()
      const inst = summaries[summaries.length - 1]
      const rt = inst?.stageRuntimes?.find((r) => r.stageId === STAGE_ID)
      const seamAns = rt?.questionBeforeAnswers?.q_seam
      if (!seamAns || !String(seamAns).trim()) {
        throw new Error('q_seam was not silent-prefilled from charter')
      }
      return {
        id: 'charter-auto',
        label: 'PR-2 charter auto-with-escalation headless smoke',
        status: 'pass',
        outcome: 'workflowCompleted',
        elapsedMs: Date.now() - started,
        workspace: ws,
        messageTypes: sent.map(msgType),
      }
    }
    if (!engine.isExecutionInFlight()) {
      const completed = sent.find((m) => msgType(m) === 'workflowCompleted')
      if (completed) break
    }
    await sleep(80)
  }
  throw new Error(`timeout — messages: ${sent.map(msgType).join(', ')}`)
}
