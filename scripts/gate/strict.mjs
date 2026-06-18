#!/usr/bin/env node
/**
 * Strict Gate CLI — MVP 验收 + Hybrid G-* 检查，输出 artifacts/gate-report.json。
 *
 * Usage:
 *   node scripts/gate/strict.mjs --workspace PATH [--task t4|t6|t7] [--bundle DIR] [--report PATH] [--json]
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

import { runStrictGate } from '../headless/lib/mvp-acceptance.mjs'
import { parseTaskArg, resolveStrictGateOpts } from './gate-profiles.mjs'

function usage() {
  return `Usage: node scripts/gate/strict.mjs --workspace PATH [options]

Options:
  --workspace PATH   待验收工作区根目录（必填）
  --task t4|t5|t6|t7  任务档位（默认 4；也可读 bundle task.json tier）
  --bundle DIR       TaskBundle 目录（默认 <workspace>/.stagent-bundle）
  --report PATH      报告输出路径（默认 <workspace>/artifacts/gate-report.json）
  --json             将完整报告打印到 stdout
  -h, --help         显示帮助
`
}

function parseArgs(argv) {
  /** @type {{ workspace: string|null, task: string|null, bundle: string|null, report: string|null, json: boolean, help: boolean }} */
  const out = {
    workspace: null,
    task: null,
    bundle: null,
    report: null,
    json: false,
    help: false,
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--workspace' && argv[i + 1]) out.workspace = argv[++i]
    else if (a === '--task' && argv[i + 1]) out.task = argv[++i]
    else if (a === '--bundle' && argv[i + 1]) out.bundle = argv[++i]
    else if (a === '--report' && argv[i + 1]) out.report = argv[++i]
    else if (a === '--json') out.json = true
    else if (a === '-h' || a === '--help') out.help = true
    else throw new Error(`未知参数：${a}\n${usage()}`)
  }
  return out
}

function loadBundle(bundleDir) {
  const taskJson = path.join(bundleDir, 'task.json')
  if (!fs.existsSync(taskJson)) return null
  try {
    return JSON.parse(fs.readFileSync(taskJson, 'utf8'))
  } catch (e) {
    throw new Error(`无法解析 ${taskJson}: ${e instanceof Error ? e.message : e}`)
  }
}

function printHumanReport(report, reportPath) {
  console.log(`gate:strict ${report.pass ? 'PASS' : 'FAIL'} — ${report.workspace}`)
  if (report.taskId) console.log(`task: ${report.taskId}`)
  for (const c of report.checks) {
    const mark = c.pass ? 'ok' : 'FAIL'
    console.log(`  [${mark}] ${c.id}: ${c.message}`)
  }
  if (report.warnings?.length) {
    for (const w of report.warnings) console.log(`  [warn] ${w}`)
  }
  console.log(`report → ${reportPath}`)
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help) {
    console.log(usage())
    process.exit(0)
  }
  if (!args.workspace) {
    console.error(usage())
    process.exit(1)
  }

  const ws = path.resolve(args.workspace)
  if (!fs.existsSync(ws)) {
    console.error(`工作区不存在：${ws}`)
    process.exit(1)
  }

  const bundleDir = path.resolve(args.bundle ?? path.join(ws, '.stagent-bundle'))
  const bundle = loadBundle(bundleDir)

  const tier = parseTaskArg(args.task ?? bundle?.tier ?? 4)
  const opts = resolveStrictGateOpts({ tier, bundle })
  const report = runStrictGate(ws, opts)

  const reportPath = path.resolve(
    args.report ?? path.join(ws, 'artifacts', 'gate-report.json'),
  )
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printHumanReport(report, reportPath)
  }

  process.exit(report.pass ? 0 : 1)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(2)
})
