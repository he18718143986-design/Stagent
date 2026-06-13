import * as fs from 'node:fs'
import * as path from 'node:path'

const PROMOTE_DIRS = ['indicators', 'signals', 'risk', 'broker', 'tests', 'src']
const PROMOTE_FILES = ['config.yaml', 'main.py', 'cli.py', 'DELIVERY.md', 'requirements.txt', 'conftest.py']

/**
 * strict pass 后将 .headless-iter 产物提升到 T4 根目录。
 * @param {string} iterDir
 * @param {string} t4Root
 * @param {{ instanceKey?: string, commit?: string, pytestSummary?: string }} meta
 */
export function promoteIterToT4Root(iterDir, t4Root, meta = {}) {
  const src = path.resolve(iterDir)
  const dst = path.resolve(t4Root)
  if (!fs.existsSync(src)) {
    throw new Error(`promote: iter dir missing: ${src}`)
  }
  fs.mkdirSync(dst, { recursive: true })

  const copied = []

  for (const f of PROMOTE_FILES) {
    const from = path.join(src, f)
    if (fs.existsSync(from) && fs.statSync(from).size > 0) {
      fs.copyFileSync(from, path.join(dst, f))
      copied.push(f)
    }
  }

  for (const dir of PROMOTE_DIRS) {
    const from = path.join(src, dir)
    if (!fs.existsSync(from)) continue
    copyDirRecursive(from, path.join(dst, dir))
    copied.push(`${dir}/`)
  }

  const manifest = {
    timestamp: new Date().toISOString(),
    from: src,
    to: dst,
    copied,
    ...meta,
  }
  fs.writeFileSync(path.join(dst, '.headless-last-promote.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

function copyDirRecursive(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const name of fs.readdirSync(from)) {
    if (name === '.stagent' || name === '.venv' || name.startsWith('.')) continue
    const srcPath = path.join(from, name)
    const dstPath = path.join(to, name)
    const st = fs.statSync(srcPath)
    if (st.isDirectory()) {
      copyDirRecursive(srcPath, dstPath)
    } else {
      fs.copyFileSync(srcPath, dstPath)
    }
  }
}
