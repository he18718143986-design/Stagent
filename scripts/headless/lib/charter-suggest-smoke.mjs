/**
 * PR-1 acceptance: charter suggest + questionBefore enrich + headless auto-answer.
 * Validates: waiting-questions → stageQuestionsBefore(suggestedAnswer) → answerQuestionsBefore → done.
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

const SMOKE_WORKFLOW = {
  id: 'wf_charter_suggest_smoke',
  version: '2.0',
  meta: {
    title: 'Charter suggest smoke',
    // prototype：跳过 software disk-bootstrap（npm init 首阶段会覆盖本 smoke 计划）
    taskType: 'prototype',
    userInput: 'PR-1 charter suggest headless smoke',
    createdAt: new Date().toISOString(),
  },
  stages: [
    {
      id: 'stage_impl_charter_smoke',
      title: 'Charter grill smoke impl',
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
      if ('suggestedAnswer' in q && typeof q.suggestedAnswer === 'string' && q.suggestedAnswer.trim()) {
        answers[id] = q.suggestedAnswer.trim()
      } else {
        answers[id] = 'headless-fallback'
      }
    }
    await engine.answerQuestionsBefore(stageId, answers)
  }
}

function assertCharterSuggestMessages(sent) {
  const waiting = sent.find(
    (m) =>
      msgType(m) === 'stageStatusUpdate' &&
      typeof m === 'object' &&
      m !== null &&
      m.status === 'waiting-questions' &&
      m.stageId === 'stage_impl_charter_smoke',
  )
  if (!waiting) {
    throw new Error('missing stageStatusUpdate waiting-questions for charter smoke stage')
  }

  const qb = sent.find(
    (m) =>
      msgType(m) === 'stageQuestionsBefore' &&
      typeof m === 'object' &&
      m !== null &&
      m.stageId === 'stage_impl_charter_smoke',
  )
  if (!qb || typeof qb !== 'object' || !Array.isArray(qb.questions) || qb.questions.length === 0) {
    throw new Error('missing stageQuestionsBefore payload')
  }
  const q0 = qb.questions[0]
  if (!q0 || typeof q0 !== 'object') {
    throw new Error('stageQuestionsBefore.questions[0] missing')
  }
  const suggested = 'suggestedAnswer' in q0 ? String(q0.suggestedAnswer ?? '').trim() : ''
  if (!suggested) {
    throw new Error('stageQuestionsBefore missing suggestedAnswer (suggest enrich failed)')
  }
  const provenance = 'provenance' in q0 ? String(q0.provenance ?? '') : ''
  if (!provenance || provenance === 'escalated') {
    throw new Error(`unexpected provenance: ${provenance || '(empty)'}`)
  }
  return {
    suggestedAnswer: suggested,
    provenance,
    ruleRefs: 'ruleRefs' in q0 && Array.isArray(q0.ruleRefs) ? q0.ruleRefs : [],
  }
}

/**
 * @param {{ mockUrl?: string, liveLlm?: { apiKey: string, baseUrl: string, model: string, maxOutputTokens?: number }, keep?: boolean, workspace?: string }} ctx
 */
export async function runCharterSuggestSmoke(ctx) {
  const started = Date.now()
  const sent = []
  const base = ctx.workspace
    ? path.dirname(path.resolve(ctx.workspace))
    : fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-charter-smoke-'))
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
    throw new Error('charter-suggest smoke requires mockUrl or liveLlm')
  }

  const platform = createHeadlessPlatform({
    workspace: ws,
    globalDir,
    llm,
    configOverrides: {
      'charter.enabled': true,
      'charter.autoAnswerMode': 'suggest',
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
  let enrich = null
  while (Date.now() < deadline) {
    await drainHitl(engine, sent, handled)
    if (!enrich) {
      try {
        enrich = assertCharterSuggestMessages(sent)
      } catch {
        /* wait until message arrives */
      }
    }
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
      if (!enrich) {
        enrich = assertCharterSuggestMessages(sent)
      }
      return {
        id: 'charter-suggest',
        label: 'PR-1 charter suggest headless smoke',
        status: 'pass',
        outcome: 'workflowCompleted',
        elapsedMs: Date.now() - started,
        workspace: ws,
        enrich,
        messageTypes: sent.map(msgType),
      }
    }
    if (!engine.isExecutionInFlight()) {
      const completed = sent.find((m) => msgType(m) === 'workflowCompleted')
      if (completed) break
      const failed = sent.find((m) => msgType(m) === 'workflowFailed')
      if (failed) {
        const reason =
          typeof failed === 'object' && failed !== null && 'reason' in failed
            ? String(failed.reason)
            : 'workflowFailed'
        throw new Error(reason)
      }
    }
    await sleep(80)
  }
  throw new Error(
    `timeout — messages: ${sent.map(msgType).join(', ')}; enrich=${enrich ? 'ok' : 'missing'}`,
  )
}
