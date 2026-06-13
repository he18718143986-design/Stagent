#!/usr/bin/env node
/**
 * 缺口 4 · 引擎 stage 级失败快照：把 RCA 第一轮「人读 .wf-state.json」自动化。
 *
 * 与 extract-failure-snapshot.js（adapter 侧日志正则）互补，本脚本读引擎落盘真源：
 *   - .wf-state.json     → 问题 stage 的 status / retryCount / lastError / exitCode /
 *                          fix 链 / runtime replan / stdout|stderr|testLog 尾部
 *   - .wf-failures.jsonl → stageId × errorType 聚合
 *   - .wf-debug.log      → gate / contract / lint / replan / stage_error 事件统计与样本
 *
 * Usage:
 *   node scripts/extract-engine-failure.mjs                      # 自动定位：headless-feedback.json 失败场景的 workspace
 *   node scripts/extract-engine-failure.mjs --workspace <path>   # 指定工作区
 *   node scripts/extract-engine-failure.mjs --instance <key>     # 指定实例（默认取最新）
 *
 * 输出：artifacts/engine-failure-snapshot.json + 人类可读摘要（stdout）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const ARTIFACTS_DIR = path.join(REPO_ROOT, 'artifacts')
const OUT_PATH = path.join(ARTIFACTS_DIR, 'engine-failure-snapshot.json')
const REPORT_PATH = path.join(ARTIFACTS_DIR, 'headless-feedback.json')

const TAIL_CHARS = 2000
const INTERESTING_EVENT_RE = /error|gate|contract|lint|replan|fix|block|exhaust/i

function parseArgs(argv) {
  const opts = { workspace: undefined, instance: undefined }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--workspace') opts.workspace = path.resolve(argv[++i])
    else if (argv[i] === '--instance') opts.instance = argv[++i]
  }
  return opts
}

/** 无 --workspace 时：取 headless-feedback.json 中失败（其次任意）场景的 workspace。 */
function resolveWorkspace(opts) {
  if (opts.workspace) return opts.workspace
  if (fs.existsSync(REPORT_PATH)) {
    const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'))
    const failed = report.scenarios?.find((s) => s.status === 'fail' && s.workspace)
    const any = report.scenarios?.find((s) => s.workspace)
    const ws = (failed ?? any)?.workspace
    if (ws && fs.existsSync(ws)) return ws
  }
  const t4Iter = path.resolve(REPO_ROOT, '../T4/.headless-iter')
  if (fs.existsSync(t4Iter)) return t4Iter
  throw new Error('无法定位工作区：请用 --workspace 指定')
}

/** 默认取 mtime 最新的实例目录。 */
function resolveInstanceDir(workspace, instanceKey) {
  const instancesDir = path.join(workspace, '.stagent', 'instances')
  if (!fs.existsSync(instancesDir)) {
    throw new Error(`无实例目录：${instancesDir}`)
  }
  if (instanceKey) {
    const dir = path.join(instancesDir, instanceKey)
    if (!fs.existsSync(dir)) throw new Error(`实例不存在：${dir}`)
    return dir
  }
  const dirs = fs
    .readdirSync(instancesDir)
    .map((k) => path.join(instancesDir, k))
    .filter((d) => fs.statSync(d).isDirectory())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  if (dirs.length === 0) throw new Error(`实例目录为空：${instancesDir}`)
  return dirs[0]
}

function tail(text, maxChars = TAIL_CHARS) {
  if (typeof text !== 'string') return undefined
  const t = text.trim()
  if (!t) return undefined
  return t.length > maxChars ? `…${t.slice(-maxChars)}` : t
}

const TERMINAL_OK = new Set(['done', 'approved', 'skipped'])

/** 问题 stage：非正常终态，或带 lastError / 非零 exitCode / fix 链痕迹。 */
function isProblemStage(rt) {
  if (!TERMINAL_OK.has(rt.status) && rt.status !== 'pending') return true
  if (rt.lastError) return true
  const outs = rt.outputs ?? {}
  if (outs._exitCode !== undefined && outs._exitCode !== 0) return true
  if (outs._fixChain?.attempts > 0) return true
  return false
}

function extractState(stateFile) {
  const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  const statusDist = {}
  const problems = []
  s.stageRuntimes.forEach((rt, i) => {
    statusDist[rt.status] = (statusDist[rt.status] ?? 0) + 1
    if (!isProblemStage(rt)) return
    const stage = s.definition.stages[i] ?? {}
    const outs = rt.outputs ?? {}
    problems.push({
      index: i,
      stageId: rt.stageId,
      title: stage.title,
      tool: stage.tool,
      status: rt.status,
      retryCount: rt.retryCount ?? 0,
      lastError:
        rt.lastError === undefined
          ? undefined
          : (typeof rt.lastError === 'string' ? rt.lastError : JSON.stringify(rt.lastError)).slice(
              0,
              500,
            ),
      exitCode: outs._exitCode,
      fixChain: outs._fixChain,
      runtimeReplan: outs._runtimeReplan,
      verificationRuns: outs._verificationRuns,
      stdoutTail: tail(outs.stdout),
      stderrTail: tail(outs.stderr),
      testLogTail: tail(outs.testLog),
    })
  })
  return {
    traceId: s.traceId,
    workflowId: s.definition?.id,
    instanceStatus: s.status,
    currentStageIndex: s.currentStageIndex,
    startedAt: s.startedAt,
    lastSavedAt: s.lastSavedAt,
    stageCount: s.definition?.stages?.length ?? 0,
    statusDist,
    problemStages: problems,
  }
}

function extractFailuresJsonl(file) {
  if (!fs.existsSync(file)) return []
  const agg = new Map()
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let r
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    const k = `${r.stageId}|${r.errorType}`
    const cur = agg.get(k) ?? {
      stageId: r.stageId,
      errorType: r.errorType,
      tool: r.tool,
      count: 0,
      lastSummary: '',
      lastRetryCount: 0,
    }
    cur.count += 1
    cur.lastSummary = r.errorSummary
    cur.lastRetryCount = r.retryCount
    agg.set(k, cur)
  }
  return [...agg.values()].sort((a, b) => b.count - a.count)
}

/** 行格式：`ISO [traceId] [scope] [event] [n] {json}` */
const DEBUG_LINE_RE = /^(\S+) \[[^\]]+\] \[([^\]]+)\] \[([^\]]+)\] \[\d+\] (.*)$/

function extractDebugEvents(file) {
  if (!fs.existsSync(file)) return { eventCounts: [], samples: [] }
  const counts = new Map()
  const samples = []
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = DEBUG_LINE_RE.exec(line)
    if (!m) continue
    const [, ts, scope, event, payload] = m
    if (!INTERESTING_EVENT_RE.test(event)) continue
    const k = `${scope}|${event}`
    counts.set(k, (counts.get(k) ?? 0) + 1)
    samples.push({ ts, scope, event, payload: payload.slice(0, 300) })
  }
  return {
    eventCounts: [...counts.entries()]
      .map(([k, count]) => {
        const [scope, event] = k.split('|')
        return { scope, event, count }
      })
      .sort((a, b) => b.count - a.count),
    samples: samples.slice(-30),
  }
}

function printSummary(snapshot) {
  console.log('')
  console.log('── engine failure snapshot ───────────────────────')
  console.log(`instance: ${snapshot.instanceDir}`)
  console.log(
    `status: ${snapshot.state.instanceStatus}  stages: ${snapshot.state.stageCount}  dist: ${JSON.stringify(snapshot.state.statusDist)}`,
  )
  if (snapshot.state.problemStages.length === 0) {
    console.log('问题 stage：无（全部正常终态）')
  } else {
    console.log(`问题 stage（${snapshot.state.problemStages.length}）：`)
    for (const p of snapshot.state.problemStages) {
      const bits = [`status=${p.status}`, `retry=${p.retryCount}`]
      if (p.exitCode !== undefined) bits.push(`exit=${p.exitCode}`)
      if (p.fixChain?.attempts) bits.push(`fix=${p.fixChain.attempts}`)
      if (p.runtimeReplan?.attempts) bits.push(`replan=${p.runtimeReplan.attempts}`)
      console.log(`  ✗ ${p.stageId} [${p.tool}] — ${bits.join(' ')}`)
      if (p.lastError) console.log(`      lastError: ${String(p.lastError).slice(0, 160)}`)
    }
  }
  if (snapshot.failures.length > 0) {
    console.log('失败记录（.wf-failures.jsonl）：')
    for (const f of snapshot.failures.slice(0, 8)) {
      console.log(`  - ${f.stageId} · ${f.errorType} ×${f.count} — ${f.lastSummary}`)
    }
  }
  if (snapshot.debug.eventCounts.length > 0) {
    console.log('debug 事件（gate/contract/error 类，top 10）：')
    for (const e of snapshot.debug.eventCounts.slice(0, 10)) {
      console.log(`  - ${e.scope} · ${e.event} ×${e.count}`)
    }
  }
  console.log(`snapshot: ${OUT_PATH}`)
  console.log('──────────────────────────────────────────────────')
  console.log('')
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const workspace = resolveWorkspace(opts)
  const instanceDir = resolveInstanceDir(workspace, opts.instance)

  const stateFile = path.join(instanceDir, '.wf-state.json')
  if (!fs.existsSync(stateFile)) {
    throw new Error(`缺 .wf-state.json：${instanceDir}`)
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    workspace,
    instanceDir,
    state: extractState(stateFile),
    failures: extractFailuresJsonl(path.join(instanceDir, '.wf-failures.jsonl')),
    debug: extractDebugEvents(path.join(instanceDir, '.wf-debug.log')),
  }

  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true })
  fs.writeFileSync(OUT_PATH, JSON.stringify(snapshot, null, 2), 'utf8')
  printSummary(snapshot)
}

main()
