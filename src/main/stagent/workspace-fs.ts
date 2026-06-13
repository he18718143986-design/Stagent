/* ------------------------------------------------------------------ */
/*  workspace-fs.ts — 工作目录真实文件的树读取 / 文本读写（供文件浏览器用） */
/*                                                                     */
/*  仅服务于「左侧文件树 + 中央编辑器」功能：读取任务工作目录的目录树、     */
/*  读取/写回单个文本文件。带基本护栏：读写仅允许发生在曾通过 fsTree 请求    */
/*  过的根目录之内，避免渲染层请求任意磁盘路径。                          */
/* ------------------------------------------------------------------ */

import * as fs from 'fs'
import * as path from 'path'

export interface FsNode {
  name: string
  /** 绝对路径 */
  path: string
  type: 'dir' | 'file'
  children?: FsNode[]
}

/** 不在文件树中展示的目录（依赖/虚拟环境/缓存/引擎内部状态）。 */
const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.stagent',
  '.mypy_cache',
  '.pytest_cache',
  'dist',
  'build',
  '.idea',
  '.vscode',
])

/** 曾被 fsTree 请求过的根目录集合；读写护栏据此放行。 */
const allowedRoots = new Set<string>()

function normalizeAbs(p: string): string {
  return path.resolve(p)
}

export function registerAllowedRoot(root: string): void {
  allowedRoots.add(normalizeAbs(root))
}

/** 目标路径是否位于某个已放行根目录之内（含根目录自身）。 */
export function isInsideAllowedRoots(target: string): boolean {
  const abs = normalizeAbs(target)
  for (const root of allowedRoots) {
    if (abs === root || abs.startsWith(root + path.sep)) {
      return true
    }
  }
  return false
}

/** 递归读取目录树。dirs 优先、按名排序；带深度与条目上限避免巨树卡死。 */
export function buildFileTree(
  root: string,
  opts: { maxDepth?: number; maxEntries?: number } = {},
): FsNode {
  const maxDepth = opts.maxDepth ?? 10
  const maxEntries = opts.maxEntries ?? 5000
  const absRoot = normalizeAbs(root)
  const counter = { n: 0 }

  function walk(dir: string, depth: number): FsNode[] {
    if (depth > maxDepth || counter.n >= maxEntries) {
      return []
    }
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const dirs: FsNode[] = []
    const files: FsNode[] = []
    for (const e of entries) {
      if (counter.n >= maxEntries) {
        break
      }
      if (e.name.startsWith('.DS_Store') || EXCLUDED_DIRS.has(e.name)) {
        continue
      }
      const full = path.join(dir, e.name)
      counter.n += 1
      if (e.isDirectory()) {
        dirs.push({ name: e.name, path: full, type: 'dir', children: walk(full, depth + 1) })
      } else if (e.isFile()) {
        files.push({ name: e.name, path: full, type: 'file' })
      }
    }
    const byName = (a: FsNode, b: FsNode): number => a.name.localeCompare(b.name)
    dirs.sort(byName)
    files.sort(byName)
    return [...dirs, ...files]
  }

  return {
    name: path.basename(absRoot) || absRoot,
    path: absRoot,
    type: 'dir',
    children: walk(absRoot, 1),
  }
}

const MAX_TEXT_BYTES = 2_000_000

function looksBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8000)
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) {
      return true
    }
  }
  return false
}

export interface ReadResult {
  ok: boolean
  content?: string
  error?: string
}

export function readTextFile(filePath: string): ReadResult {
  if (!isInsideAllowedRoots(filePath)) {
    return { ok: false, error: 'path-not-allowed' }
  }
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) {
      return { ok: false, error: 'not-a-file' }
    }
    if (stat.size > MAX_TEXT_BYTES) {
      return { ok: false, error: `file-too-large(${stat.size}>${MAX_TEXT_BYTES})` }
    }
    const buf = fs.readFileSync(filePath)
    if (looksBinary(buf)) {
      return { ok: false, error: 'binary-file' }
    }
    return { ok: true, content: buf.toString('utf-8') }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface WriteResult {
  ok: boolean
  error?: string
}

export function writeTextFile(filePath: string, content: string): WriteResult {
  if (!isInsideAllowedRoots(filePath)) {
    return { ok: false, error: 'path-not-allowed' }
  }
  if (typeof content !== 'string') {
    return { ok: false, error: 'invalid-content' }
  }
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content, 'utf-8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
