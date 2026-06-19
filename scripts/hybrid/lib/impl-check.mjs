/**
 * CodeAct 结束后 impl 非空预检（T4 batch run#4/#5 空 impl 方差）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

import { LIVE_TASK_TIERS } from '../../headless/lib/live-tasks.mjs'
import { MVP_MODULE_DIRS } from '../../headless/lib/mvp-acceptance.mjs'

/** T4/T5 空 impl 专用 early retry 次数（不计入 Gate 回流，仅跳过 Gate 立即再跑 CodeAct） */
export const DEFAULT_EMPTY_IMPL_RETRIES = 2

const SKIP_SCAN_DIRS = new Set([
  '.stagent-bundle',
  'artifacts',
  'tests',
  'scripts',
  'fixtures',
  'data',
  '.venv',
  'venv',
  'node_modules',
  '.git',
  '__pycache__',
])

/**
 * @param {string} filePath
 */
export function fileNonEmpty(filePath) {
  try {
    return fs.statSync(filePath).isFile() && fs.statSync(filePath).size > 0
  } catch {
    return false
  }
}

/**
 * @param {string} dir
 */
export function dirHasNonEmptyPy(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false
  return fs.readdirSync(dir).some((name) => {
    if (!name.endsWith('.py')) return false
    return fileNonEmpty(path.join(dir, name))
  })
}

/**
 * @param {object|null|undefined} bundle task.json
 * @param {number} tier
 * @returns {string[]}
 */
export function resolveModuleDirs(bundle, tier) {
  const fromBundle = bundle?.mvp?.moduleDirs
  if (Array.isArray(fromBundle) && fromBundle.length > 0) return fromBundle
  if (tier === 4 || tier === 5) return [...MVP_MODULE_DIRS]
  const spec = LIVE_TASK_TIERS[tier]
  if (spec?.mvp?.moduleDirs?.length) return spec.mvp.moduleDirs
  return []
}

/**
 * @param {number} tier
 * @param {object|null|undefined} bundle
 */
export function resolveEmptyImplRetries(tier, bundle) {
  const dirs = resolveModuleDirs(bundle, tier)
  if (dirs.length === 0) return 0
  if (tier === 4 || tier === 5) return DEFAULT_EMPTY_IMPL_RETRIES
  return 1
}

/**
 * @param {string} workspace
 */
export function countWorkspaceImplPy(workspace) {
  const ws = path.resolve(workspace)
  let count = 0

  /** @param {string} dir */
  function walk(dir) {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (SKIP_SCAN_DIRS.has(ent.name)) continue
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        walk(full)
      } else if (ent.isFile() && ent.name.endsWith('.py') && fileNonEmpty(full)) {
        count++
      }
    }
  }

  walk(ws)
  return count
}

/**
 * @param {string} workspace
 * @param {{ bundle?: object|null, tier?: number }} ctx
 * @returns {{ pass: boolean, missing: string[], moduleDirs: string[], implPyCount: number }}
 */
export function checkImplNonEmpty(workspace, ctx = {}) {
  const ws = path.resolve(workspace)
  const tier = ctx.tier ?? 4
  const bundle = ctx.bundle ?? null
  const moduleDirs = resolveModuleDirs(bundle, tier)
  /** @type {string[]} */
  const missing = []

  if (!fileNonEmpty(path.join(ws, 'main.py'))) {
    missing.push('main.py（无参可运行的入口，非空）')
  }

  for (const dir of moduleDirs) {
    const abs = path.join(ws, dir)
    if (!dirHasNonEmptyPy(abs)) {
      missing.push(`${dir}/（至少一个非空 .py 模块）`)
    }
  }

  const implPyCount = countWorkspaceImplPy(ws)

  return {
    pass: missing.length === 0,
    missing,
    moduleDirs,
    implPyCount,
  }
}
