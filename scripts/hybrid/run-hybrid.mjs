#!/usr/bin/env node
/**
 * Hybrid 一键流水线：spec:export → codeact:run → gate:strict（失败可回流）。
 *
 * Usage:
 *   node scripts/hybrid/run-hybrid.mjs --tier 4 --workspace ./ws
 *   node scripts/hybrid/run-hybrid.mjs --tier 7 --workspace ./ws --mock
 */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseTierArg } from '../export/bundle-profiles.mjs'
import { exportTaskBundle } from '../export/task-bundle.mjs'
import { resolveStrictGateOpts } from '../gate/gate-profiles.mjs'
import { runStrictGate } from '../headless/lib/mvp-acceptance.mjs'
import { loadEnvLocal } from '../lib/load-env-local.mjs'
import {
  buildFixPrompt,
  classifyGateFailure,
  writeFixPromptFile,
} from './lib/gate-failure.mjs'
import { spawnCodeAct } from './lib/spawn-codeact-core.mjs'

function usage() {
  return `Usage: node scripts/hybrid/run-hybrid.mjs --tier t4|t5|t6|t7 --workspace PATH [options]

Options:
  --tier t4|t5|t6|t7     任务档位（必填）
  --workspace PATH       工作区根目录（必填）
  --max-retries N        Gate 失败后 CodeAct 回流次数（默认 2）
  --mock                 跳过 CodeAct（只 export + gate，不烧 API）
  --skip-export          跳过 spec:export（bundle 须已存在）
  --skip-codeact         只跑 gate（不调用 CodeAct）
  --gate-only            同 --skip-export --skip-codeact
  --force                export 时覆盖 seed 文件
  --json                 将 hybrid 报告打印到 stdout
  -h, --help             显示帮助
`
}

function parseArgs(argv) {
  /** @type {Record<string, unknown>} */
  const out = {
    tier: null,
    workspace: null,
    maxRetries: 2,
    mock: false,
    skipExport: false,
    skipCodeact: false,
    gateOnly: false,
    force: false,
    json: false,
    help: false,
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--tier' && argv[i + 1]) out.tier = argv[++i]
    else if (a === '--workspace' && argv[i + 1]) out.workspace = argv[++i]
    else if (a === '--max-retries' && argv[i + 1]) out.maxRetries = Number(argv[++i])
    else if (a === '--mock') out.mock = true
    else if (a === '--skip-export') out.skipExport = true
    else if (a === '--skip-codeact') out.skipCodeact = true
    else if (a === '--gate-only') {
      out.gateOnly = true
      out.skipExport = true
      out.skipCodeact = true
    } else if (a === '--force') out.force = true
    else if (a === '--json') out.json = true
    else if (a === '-h' || a === '--help') out.help = true
    else throw new Error(`未知参数：${a}\n${usage()}`)
  }
  return out
}

function loadBundle(bundleDir) {
  const p = path.join(bundleDir, 'task.json')
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

function runGate(workspace, bundleDir, tier) {
  const bundle = loadBundle(bundleDir)
  const opts = resolveStrictGateOpts({ tier, bundle })
  const report = runStrictGate(workspace, opts)
  const reportPath = path.join(workspace, 'artifacts', 'gate-report.json')
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return { report, reportPath }
}

/**
 * @param {object} ctx
 * @returns {object} hybrid report
 */
export function runHybridPipeline(ctx) {
  const {
    tier,
    workspace,
    maxRetries = 2,
    mock = false,
    skipExport = false,
    skipCodeact = false,
    force = false,
    runId = `hybrid-${Date.now()}`,
  } = ctx

  const ws = path.resolve(workspace)
  const bundleDir = path.join(ws, '.stagent-bundle')
  fs.mkdirSync(ws, { recursive: true })

  /** @type {object[]} */
  const attempts = []

  if (!skipExport) {
    exportTaskBundle({ tier, bundleDir, workspaceDir: ws, force, dryRun: false })
  } else if (
    !skipCodeact &&
    !mock &&
    !fs.existsSync(path.join(bundleDir, 'task.json'))
  ) {
    throw new Error(`缺少 bundle：${bundleDir}（去掉 --skip-export 或先 spec:export）`)
  }

  let fixPromptPath = null
  const gateIterations = skipCodeact || mock ? 1 : 1 + Math.max(0, maxRetries)

  for (let i = 0; i < gateIterations; i++) {
    const attemptNo = i + 1
    /** @type {object} */
    const attempt = { attempt: attemptNo, codeact: null, gate: null, category: null }

    if (!skipCodeact && !mock) {
      const eventsOut = path.join(ws, 'artifacts', `codeact-${runId}-a${attemptNo}.jsonl`)
      const codeact = spawnCodeAct({
        bundle: bundleDir,
        workspace: ws,
        fixPromptPath,
        eventsOut,
      })
      attempt.codeact = {
        exitCode: codeact.exitCode,
        eventsOut,
        error: codeact.error ?? null,
      }
      if (codeact.error) {
        attempt.category = 'gate_infra'
        attempts.push(attempt)
        return buildHybridReport({
          pass: false,
          tier,
          workspace: ws,
          runId,
          attempts,
          finalCategory: 'gate_infra',
        })
      }
    } else if (mock) {
      attempt.codeact = { skipped: true, reason: 'mock' }
    } else {
      attempt.codeact = { skipped: true, reason: 'skip-codeact' }
    }

    const { report, reportPath } = runGate(ws, bundleDir, tier)
    attempt.gate = { pass: report.pass, reportPath, errors: report.errors }
    attempt.category = report.pass ? 'pass' : classifyGateFailure(report)
    attempts.push(attempt)

    if (report.pass) {
      return buildHybridReport({ pass: true, tier, workspace: ws, runId, attempts })
    }

    if (attempt.category !== 'implementation' || i >= maxRetries || skipCodeact || mock) {
      break
    }

    const fixText = buildFixPrompt(report, i + 1)
    fixPromptPath = writeFixPromptFile(ws, fixText)
    attempt.fixPromptPath = fixPromptPath
  }

  const last = attempts[attempts.length - 1]
  return buildHybridReport({
    pass: false,
    tier,
    workspace: ws,
    runId,
    attempts,
    finalCategory: last?.category ?? 'implementation',
  })
}

function buildHybridReport({ pass, tier, workspace, runId, attempts, finalCategory = null }) {
  const bundle = loadBundle(path.join(workspace, '.stagent-bundle'))
  return {
    pass,
    runId,
    tier,
    taskId: bundle?.taskId ?? null,
    workspace,
    timestamp: new Date().toISOString(),
    attempts,
    finalCategory: pass ? 'pass' : finalCategory,
  }
}

function printHumanSummary(report, reportPath) {
  console.log(`hybrid:${report.pass ? 'PASS' : 'FAIL'} — tier ${report.tier} (${report.taskId ?? '?'})`)
  console.log(`  workspace → ${report.workspace}`)
  console.log(`  attempts: ${report.attempts.length}`)
  if (!report.pass && report.finalCategory) {
    console.log(`  category: ${report.finalCategory}`)
  }
  console.log(`  report → ${reportPath}`)
}

async function main() {
  loadEnvLocal()
  if (!process.env.OPENHANDS_SUPPRESS_BANNER) {
    process.env.OPENHANDS_SUPPRESS_BANNER = '1'
  }

  const args = parseArgs(process.argv)
  if (args.help) {
    console.log(usage())
    process.exit(0)
  }
  if (!args.tier || !args.workspace) {
    console.error(usage())
    process.exit(1)
  }

  const tier = parseTierArg(args.tier)
  const runId = `hybrid-${crypto.randomBytes(4).toString('hex')}`

  const report = runHybridPipeline({
    tier,
    workspace: args.workspace,
    maxRetries: typeof args.maxRetries === 'number' ? args.maxRetries : 2,
    mock: args.mock,
    skipExport: args.skipExport,
    skipCodeact: args.skipCodeact,
    force: args.force,
    runId,
  })

  const reportPath = path.join(path.resolve(args.workspace), 'artifacts', 'hybrid-run.json')
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printHumanSummary(report, reportPath)
  }

  process.exit(report.pass ? 0 : 1)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(2)
  })
}
