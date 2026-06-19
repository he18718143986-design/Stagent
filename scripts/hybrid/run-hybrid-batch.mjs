#!/usr/bin/env node
/**
 * Batch hybrid runs — export → codeact → gate (or mock) × N, aggregate success rate.
 *
 * Usage:
 *   node scripts/hybrid/run-hybrid-batch.mjs --tier 4 --workspace ./ws --repeat 3
 *   node scripts/hybrid/run-hybrid-batch.mjs --tier 7 --mock --repeat 5
 */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseTierArg } from '../export/bundle-profiles.mjs'
import { loadEnvLocal } from '../lib/load-env-local.mjs'
import { applyDeepSeekDefaults } from './lib/deepseek-env.mjs'
import { runHybridPipeline } from './run-hybrid.mjs'

function usage() {
  return `Usage: node scripts/hybrid/run-hybrid-batch.mjs --tier t4|t5|t6|t7 --repeat N [options]

Options:
  --tier t4|t5|t6|t7     任务档位（必填）
  --repeat N             连跑次数（默认 3）
  --workspace PATH       工作区根（默认临时目录）
  --mock                 跳过 CodeAct（不烧 API）
  --pass-threshold M     通过次数 ≥ M 则 exit 0（默认 ceil(0.6*N)）
  --json                 stdout 输出 JSON 报告
  -h, --help             显示帮助
`
}

function parseArgs(argv) {
  const out = {
    tier: null,
    repeat: 3,
    workspace: null,
    mock: false,
    passThreshold: null,
    json: false,
    help: false,
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--tier' && argv[i + 1]) out.tier = argv[++i]
    else if (a === '--repeat' && argv[i + 1]) out.repeat = Math.max(1, Number(argv[++i]))
    else if (a === '--workspace' && argv[i + 1]) out.workspace = argv[++i]
    else if (a === '--mock') out.mock = true
    else if (a === '--pass-threshold' && argv[i + 1]) {
      out.passThreshold = Math.max(1, Number(argv[++i]))
    } else if (a === '--json') out.json = true
    else if (a === '-h' || a === '--help') out.help = true
    else throw new Error(`未知参数：${a}\n${usage()}`)
  }
  return out
}

async function main() {
  loadEnvLocal()
  applyDeepSeekDefaults({ requireKey: false })
  const args = parseArgs(process.argv)
  if (args.help) {
    console.log(usage())
    process.exit(0)
  }
  if (!args.tier) {
    console.error(usage())
    process.exit(1)
  }

  const tier = parseTierArg(args.tier)
  const batchRoot =
    args.workspace ?? fs.mkdtempSync(path.join(os.tmpdir(), `hybrid-batch-t${tier}-`))
  const isolatedRuns = !args.workspace && args.repeat > 1
  const batchId = crypto.randomBytes(4).toString('hex')
  const batchDir = path.join(batchRoot, 'artifacts', `hybrid-batch-${batchId}`)
  fs.mkdirSync(batchDir, { recursive: true })

  const runs = []
  for (let i = 1; i <= args.repeat; i++) {
    const ws = isolatedRuns ? path.join(batchRoot, `run-${i}`) : batchRoot
    const runId = `batch-${batchId}-r${i}`
    const report = runHybridPipeline({
      tier,
      workspace: ws,
      mock: args.mock,
      force: true,
      runId,
    })
    const runPath = path.join(batchDir, `run-${i}.json`)
    fs.writeFileSync(runPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    runs.push({ run: i, pass: report.pass, workspace: ws, reportPath: runPath, report })
    if (!args.mock && i < args.repeat) {
      await new Promise((r) => setTimeout(r, 12_000))
    }
  }

  const passed = runs.filter((r) => r.pass).length
  const threshold = args.passThreshold ?? Math.ceil(0.6 * args.repeat)
  const batchReport = {
    batchId,
    tier,
    workspace: batchRoot,
    isolatedRuns,
    repeat: args.repeat,
    mock: args.mock,
    passed,
    threshold,
    verdict: passed >= threshold ? 'pass' : 'fail',
    runs: runs.map(({ run, pass, workspace, reportPath, report }) => ({
      run,
      pass,
      workspace,
      reportPath,
      attempts: report.attempts?.length ?? 0,
      finalCategory: report.finalCategory ?? null,
    })),
    timestamp: new Date().toISOString(),
  }
  const summaryPath = path.join(batchDir, 'batch-summary.json')
  fs.writeFileSync(summaryPath, `${JSON.stringify(batchReport, null, 2)}\n`, 'utf8')

  if (args.json) {
    console.log(JSON.stringify(batchReport, null, 2))
  } else {
    console.log(
      `hybrid-batch:${batchReport.verdict.toUpperCase()} — tier ${tier} ${passed}/${args.repeat} (threshold ${threshold})`,
    )
    console.log(`  batch root → ${batchRoot}`)
    if (isolatedRuns) console.log(`  isolated: run-1 … run-${args.repeat} under batch root`)
    console.log(`  summary → ${summaryPath}`)
  }

  process.exit(batchReport.verdict === 'pass' ? 0 : 1)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(2)
})
