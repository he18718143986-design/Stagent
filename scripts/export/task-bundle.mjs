#!/usr/bin/env node
/**
 * Export TaskBundle (.stagent-bundle) for Hybrid CodeAct pipeline.
 *
 * Usage:
 *   node scripts/export/task-bundle.mjs --tier t4 --workspace ./ws
 *   node scripts/export/task-bundle.mjs --tier t7 --out examples/bundles/t7-finance
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  TEMPLATES_DIR,
  buildOpenhandsPrompt,
  buildTaskJson,
  parseTierArg,
  resolveBundleProfile,
  resolveSpecRefPath,
} from './bundle-profiles.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))

function usage() {
  return `Usage: node scripts/export/task-bundle.mjs --tier t4|t5|t6|t7 [options]

Options:
  --tier t4|t5|t6|t7   任务档位（必填）
  --workspace PATH     工作区；bundle 写入 <workspace>/.stagent-bundle 并 seed 冻结文件
  --out PATH           直接输出 bundle 目录（与 --workspace 二选一）
  --force              覆盖已存在的 seed 文件
  --dry-run            只打印将写入的文件，不落盘
  -h, --help           显示帮助
`
}

function parseArgs(argv) {
  /** @type {{ tier: string|null, workspace: string|null, out: string|null, force: boolean, dryRun: boolean, help: boolean }} */
  const out = {
    tier: null,
    workspace: null,
    out: null,
    force: false,
    dryRun: false,
    help: false,
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--tier' && argv[i + 1]) out.tier = argv[++i]
    else if (a === '--workspace' && argv[i + 1]) out.workspace = argv[++i]
    else if (a === '--out' && argv[i + 1]) out.out = argv[++i]
    else if (a === '--force') out.force = true
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '-h' || a === '--help') out.help = true
    else throw new Error(`未知参数：${a}\n${usage()}`)
  }
  return out
}

function copyFile(src, dest, { force, dryRun }) {
  if (!fs.existsSync(src)) return false
  if (fs.existsSync(dest) && !force) return false
  if (dryRun) {
    console.log(`  would copy ${src} → ${dest}`)
    return true
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  return true
}

function writeFile(dest, content, { force, dryRun }) {
  if (fs.existsSync(dest) && !force) return false
  if (dryRun) {
    console.log(`  would write ${dest} (${content.length} bytes)`)
    return true
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, content.endsWith('\n') ? content : `${content}\n`, 'utf8')
  return true
}

function copyTree(srcDir, destDir, relPaths, opts) {
  const written = []
  for (const rel of relPaths) {
    const src = path.join(srcDir, rel)
    const dest = path.join(destDir, rel)
    if (!fs.existsSync(src)) continue
    if (copyFile(src, dest, opts)) written.push(dest)
  }
  return written
}

/**
 * @param {{ tier: number, bundleDir: string, workspaceDir: string|null, force: boolean, dryRun: boolean }} ctx
 */
export function exportTaskBundle(ctx) {
  const { tier, bundleDir, workspaceDir, force, dryRun } = ctx
  const { spec, profile, templateId } = resolveBundleProfile(tier)
  const templateDir = path.join(TEMPLATES_DIR, templateId)

  if (!fs.existsSync(templateDir)) {
    throw new Error(`模板目录不存在：${templateDir}`)
  }

  const written = []
  const specRefsCopied = []

  // 1) task.json
  const task = buildTaskJson({ tier, spec })
  const taskPath = path.join(bundleDir, 'task.json')
  if (
    writeFile(taskPath, `${JSON.stringify(task, null, 2)}\n`, { force: true, dryRun })
  ) {
    written.push(taskPath)
  }

  // 2) specRefs → bundle + task.specRefs
  for (const ref of profile.specRefs) {
    const src = resolveSpecRefPath(ref)
    const dest = path.join(bundleDir, ref.dest)
    if (!fs.existsSync(src)) {
      if (ref.required) throw new Error(`缺少规格文件：${src}`)
      continue
    }
    if (copyFile(src, dest, { force: true, dryRun })) {
      written.push(dest)
      specRefsCopied.push(ref.dest)
    }
  }
  task.specRefs = specRefsCopied
  writeFile(taskPath, `${JSON.stringify(task, null, 2)}\n`, { force: true, dryRun })

  // 3) OPENHANDS_PROMPT.md
  const prompt = buildOpenhandsPrompt(tier, spec.label)
  const promptPath = path.join(bundleDir, 'OPENHANDS_PROMPT.md')
  if (writeFile(promptPath, prompt, { force: true, dryRun })) written.push(promptPath)

  // 4) template tree (config.contract, scripts, tests, fixtures)
  const templateFiles = listTemplateFiles(templateDir)
  for (const rel of templateFiles) {
    const src = path.join(templateDir, rel)
    const dest = path.join(bundleDir, rel)
    if (copyFile(src, dest, { force: true, dryRun })) written.push(dest)
  }

  // 5) seed workspace with frozen oracle files
  if (workspaceDir) {
    const seedRel = profile.seedWorkspace ?? []
    for (const rel of seedRel) {
      const src = path.join(templateDir, rel)
      const dest = path.join(workspaceDir, rel)
      if (!fs.existsSync(src)) continue
      if (copyFile(src, dest, { force, dryRun })) written.push(dest)
    }
    // acceptance.sh executable bit
    const acc = path.join(workspaceDir, 'scripts/acceptance.sh')
    if (!dryRun && fs.existsSync(acc)) {
      fs.chmodSync(acc, 0o755)
    }
  }

  return {
    tier,
    taskId: spec.id,
    bundleDir,
    workspaceDir,
    written,
    specRefs: specRefsCopied,
  }
}

function listTemplateFiles(templateDir, base = '') {
  const out = []
  for (const name of fs.readdirSync(path.join(templateDir, base))) {
    const rel = base ? `${base}/${name}` : name
    const full = path.join(templateDir, rel)
    if (fs.statSync(full).isDirectory()) {
      out.push(...listTemplateFiles(templateDir, rel))
    } else {
      out.push(rel)
    }
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help) {
    console.log(usage())
    process.exit(0)
  }
  if (!args.tier) {
    console.error(usage())
    process.exit(1)
  }
  if (!args.workspace && !args.out) {
    console.error('必须指定 --workspace 或 --out\n' + usage())
    process.exit(1)
  }

  const tier = parseTierArg(args.tier)
  const workspaceDir = args.workspace ? path.resolve(args.workspace) : null
  const bundleDir = args.out
    ? path.resolve(args.out)
    : path.join(workspaceDir, '.stagent-bundle')

  if (workspaceDir && !fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true })
  }

  const result = exportTaskBundle({
    tier,
    bundleDir,
    workspaceDir,
    force: args.force,
    dryRun: args.dryRun,
  })

  if (args.dryRun) {
    console.log(`dry-run tier=${tier} bundle=${bundleDir}`)
  } else {
    console.log(`spec:export OK — tier ${tier} (${result.taskId})`)
    console.log(`  bundle → ${bundleDir}`)
    if (workspaceDir) console.log(`  workspace → ${workspaceDir}`)
    console.log(`  files: ${result.written.length}`)
    for (const ref of result.specRefs) console.log(`  spec: ${ref}`)
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(2)
  })
}
