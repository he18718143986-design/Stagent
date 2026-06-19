/**
 * Generate minimal T4 fixture CSV seeds (≥120 rows for indicator warmup).
 * Used by spec:export / deliver:t4 — data must land on disk (G-fixtures-on-disk).
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROWS = 130

function isoMinute(base, i) {
  const d = new Date(base)
  d.setUTCMinutes(d.getUTCMinutes() + i * 3)
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function genBars3m() {
  const base = Date.parse('2024-01-02T01:30:00Z')
  const lines = ['timestamp,open,high,low,close,volume']
  let close = 3500
  for (let i = 0; i < ROWS; i++) {
    const o = close
    const h = o + 2 + (i % 5) * 0.2
    const l = o - 2 - (i % 4) * 0.15
    close = l + (h - l) * 0.55
    const vol = 800 + (i % 17) * 40
    lines.push(`${isoMinute(base, i)},${o.toFixed(2)},${h.toFixed(2)},${l.toFixed(2)},${close.toFixed(2)},${vol}`)
  }
  return `${lines.join('\n')}\n`
}

function genBars1m() {
  const base = Date.parse('2024-01-02T01:30:00Z')
  const lines = ['timestamp,open,high,low,close,volume']
  let close = 3500
  for (let i = 0; i < ROWS * 3; i++) {
    const d = new Date(base + i * 60_000)
    const ts = d.toISOString().replace(/\.\d{3}Z$/, 'Z')
    const o = close
    const h = o + 1.2
    const l = o - 1.1
    close = l + (h - l) * 0.5
    lines.push(`${ts},${o.toFixed(2)},${h.toFixed(2)},${l.toFixed(2)},${close.toFixed(2)},${200 + (i % 11) * 10}`)
  }
  return `${lines.join('\n')}\n`
}

function genIndex() {
  const base = Date.parse('2024-01-02T01:30:00Z')
  const lines = ['timestamp,close']
  let close = 3000
  for (let i = 0; i < ROWS; i++) {
    close += (i % 7 === 0 ? -3 : 1.5)
    lines.push(`${isoMinute(base, i)},${close.toFixed(2)}`)
  }
  return `${lines.join('\n')}\n`
}

const T4_DATA_FILES = {
  'data/bars_3m.csv': genBars3m,
  'data/bars_1m.csv': genBars1m,
  'data/index_sh.csv': genIndex,
  'data/index_sz.csv': genIndex,
}

/**
 * @param {string} workspaceDir
 * @param {{ force?: boolean, dryRun?: boolean }} opts
 * @returns {string[]} written paths
 */
export function seedT4FixtureCsvs(workspaceDir, opts = {}) {
  const { force = false, dryRun = false } = opts
  const ws = path.resolve(workspaceDir)
  const written = []

  for (const [rel, gen] of Object.entries(T4_DATA_FILES)) {
    const dest = path.join(ws, rel)
    if (fs.existsSync(dest) && !force) continue
    const content = gen()
    if (dryRun) {
      written.push(dest)
      continue
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, content, 'utf8')
    written.push(dest)
  }

  const configPath = path.join(ws, 'config.yaml')
  const configYaml = `# T4 默认数据路径（Gate G-fixtures-on-disk）
data:
  bars_3m: "data/bars_3m.csv"
  bars_1m: "data/bars_1m.csv"
  index_sh: "data/index_sh.csv"
  index_sz: "data/index_sz.csv"
output:
  signals: signals.csv
  summary: backtest_summary.json
`
  if (!fs.existsSync(configPath) || force) {
    if (!dryRun) {
      fs.writeFileSync(configPath, configYaml, 'utf8')
    }
    written.push(configPath)
  }

  return written
}
