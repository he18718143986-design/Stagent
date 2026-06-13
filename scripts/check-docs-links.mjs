/* ------------------------------------------------------------------ */
/*  check-docs-links.mjs — 文档防腐门禁：校验 README + docs/ 的相对链接   */
/*                                                                     */
/*  扫描 markdown 中的 [text](target) 相对链接，目标不存在即报错并以      */
/*  非 0 退出（接入 regression:loop，防止文档再次腐化——见 2026-06-11     */
/*  审计：STAGENT-PRD 等曾有 22+ 处断链）。                              */
/*                                                                     */
/*  用法：node scripts/check-docs-links.mjs [repoRoot=cwd]              */
/* ------------------------------------------------------------------ */

import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? process.cwd())

/** 收集待扫描的 markdown 文件（README + docs/ 递归）。 */
function collectMarkdownFiles() {
  const files = []
  const readmePath = path.join(root, 'README.md')
  if (fs.existsSync(readmePath)) files.push(readmePath)
  const docsDir = path.join(root, 'docs')
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.name.toLowerCase().endsWith('.md')) files.push(p)
    }
  }
  if (fs.existsSync(docsDir)) walk(docsDir)
  return files
}

const LINK_RE = /\]\(([^)#\s]+?)(#[^)]*)?\)/g

function isExternal(target) {
  return /^(https?:|mailto:|tel:)/.test(target)
}

const broken = []
for (const file of collectMarkdownFiles()) {
  const baseDir = path.dirname(file)
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, idx) => {
    for (const match of line.matchAll(LINK_RE)) {
      const target = match[1].trim()
      if (!target || isExternal(target)) continue
      const resolved = path.normalize(path.join(baseDir, target))
      if (!fs.existsSync(resolved)) {
        broken.push(`${path.relative(root, file)}:${idx + 1} -> ${target}`)
      }
    }
  })
}

if (broken.length > 0) {
  console.error(`docs link check FAILED: ${broken.length} broken link(s)`)
  for (const b of broken) console.error(`  ${b}`)
  process.exit(1)
}
console.log('docs link check passed')
