#!/usr/bin/env node
/**
 * 大陆客户 T4 一键交付：spec:export → fixture 种子 → CodeAct → gate:strict
 *
 * Usage:
 *   npm run deliver:t4 -- --workspace ./my-futures-ws
 *   npm run deliver:t4 -- --workspace ./ws --mock          # 不烧 API（只 export+gate）
 *   npm run deliver:t4 -- --workspace ./ws --json
 */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { seedT4FixtureCsvs } from '../export/t4-fixture-seeds.mjs'
import { loadEnvLocal } from '../lib/load-env-local.mjs'
import { applyDeepSeekDefaults, assertCodeActVenv } from './lib/deepseek-env.mjs'
import { runHybridPipeline } from './run-hybrid.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const VENV_CLI = path.join(REPO_ROOT, 'packages/codeact-runner/.venv/bin/stagent-codeact')

function usage() {
  return `Usage: npm run deliver:t4 -- --workspace PATH [options]

大陆客户 T4 一键交付（南华期货回测 MVP · strict Gate 为唯一裁判）

Options:
  --workspace PATH   工作区根目录（必填；可空目录，将自动创建）
  --mock             跳过 CodeAct（export + fixture 种子 + gate only）
  --max-retries N    Gate 失败后 CodeAct 回流次数（默认 2）
  --force            覆盖已有 seed / fixture 文件
  --json             stdout 输出完整 hybrid 报告
  -h, --help         显示帮助

环境:
  DEEPSEEK_API_KEY   DeepSeek API 密钥（live 必填）
  LLM_MODEL          默认 deepseek/deepseek-chat
  LLM_BASE_URL       默认 https://api.deepseek.com/v1

交付成功: exit 0 + artifacts/gate-report.json (pass) + artifacts/hybrid-run.json
`
}

function parseArgs(argv) {
  const out = {
    workspace: null,
    mock: false,
    maxRetries: 2,
    force: false,
    json: false,
    help: false,
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--workspace' && argv[i + 1]) out.workspace = argv[++i]
    else if (a === '--mock') out.mock = true
    else if (a === '--max-retries' && argv[i + 1]) out.maxRetries = Number(argv[++i])
    else if (a === '--force') out.force = true
    else if (a === '--json') out.json = true
    else if (a === '-h' || a === '--help') out.help = true
    else throw new Error(`未知参数：${a}\n${usage()}`)
  }
  return out
}

function printDeliverSummary(report, reportPath) {
  const mark = report.pass ? 'PASS' : 'FAIL'
  console.log(`\n══ deliver:t4 ${mark} ══════════════════════════════`)
  console.log(`  task:     ${report.taskId ?? 'live-t4-nanhua-futures'}`)
  console.log(`  workspace: ${report.workspace}`)
  console.log(`  attempts: ${report.attempts?.length ?? 0}`)
  if (!report.pass && report.finalCategory) {
    console.log(`  category: ${report.finalCategory}`)
  }
  const gatePath = path.join(report.workspace, 'artifacts', 'gate-report.json')
  console.log(`  gate →    ${gatePath}`)
  console.log(`  hybrid →  ${reportPath}`)
  if (report.pass) {
    console.log('\n  验收: npm run gate:strict -- --workspace <ws> --task t4')
  }
  console.log('══════════════════════════════════════════════════\n')
}

export function runDeliverT4(ctx) {
  const {
    workspace,
    mock = false,
    maxRetries = 2,
    force = false,
    runId = `deliver-t4-${crypto.randomBytes(4).toString('hex')}`,
  } = ctx

  const ws = path.resolve(workspace)
  fs.mkdirSync(ws, { recursive: true })

  seedT4FixtureCsvs(ws, { force })

  return runHybridPipeline({
    tier: 4,
    workspace: ws,
    mock,
    maxRetries,
    force,
    runId,
  })
}

async function main() {
  loadEnvLocal(REPO_ROOT)

  const args = parseArgs(process.argv)
  if (args.help) {
    console.log(usage())
    process.exit(0)
  }
  if (!args.workspace) {
    console.error(usage())
    process.exit(1)
  }

  if (!args.mock) {
    const env = applyDeepSeekDefaults({ requireKey: true })
    if (!env.ok) {
      console.error(env.error)
      process.exit(1)
    }
    const venv = assertCodeActVenv(VENV_CLI)
    if (!venv.ok) {
      console.error(venv.error)
      process.exit(1)
    }
  } else {
    applyDeepSeekDefaults({ requireKey: false })
  }

  const runId = `deliver-t4-${crypto.randomBytes(4).toString('hex')}`
  const report = runDeliverT4({
    workspace: args.workspace,
    mock: args.mock,
    maxRetries: args.maxRetries,
    force: args.force,
    runId,
  })

  const reportPath = path.join(path.resolve(args.workspace), 'artifacts', 'hybrid-run.json')
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printDeliverSummary(report, reportPath)
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
