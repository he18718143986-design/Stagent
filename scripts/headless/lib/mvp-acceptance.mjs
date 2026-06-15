import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'

/** 默认 MVP 交付目录（对照 T4 南华期货需求 §五）。 */
export const MVP_MODULE_DIRS = ['indicators', 'signals', 'risk', 'broker']

/**
 * Traceability 规则形态（SSOT，平台 + 量化任务共用）：
 *   - 声明式：{ id, dirs, pattern, requireDirPy?, hint } —— 读取 dirs（含 tests）正文，
 *     pattern 命中即通过；requireDirPy 要求该目录有非空 .py。
 *   - 函数式（兼容旧规则）：{ id, check: (ws, readText) => boolean, hint }。
 * 默认 TRACEABILITY_RULES 为 T4 量化语义规则；确定性平台任务由 spec.mvp.traceability 覆盖。
 */
export const TRACEABILITY_RULES = [
  {
    id: 'index-resonance',
    dirs: ['signals', 'tests'],
    pattern: /上证|深证|指数|index/i,
    hint: 'signals/ 或 tests/ 应含指数共振相关逻辑或 fixture',
  },
  {
    id: 'hedge-stop-loss',
    dirs: ['risk', 'tests'],
    requireDirPy: 'risk',
    pattern: /hedge|stop_loss|止损|对冲/i,
    hint: 'risk/ 非空且 tests/ 或 risk/ 含 hedge/stop_loss 相关符号',
  },
  {
    id: 'sim-broker',
    dirs: ['broker', 'src'],
    pattern: /SimBroker|BrokerAdapter/,
    hint: 'broker/ 或 src/ 含 SimBroker 或 BrokerAdapter',
  },
]

/**
 * 评估单条 traceability 规则（声明式或函数式）。
 * @param {string} ws 工作区根
 * @param {object} rule
 * @param {(subs: string[]) => string} readText
 */
export function evaluateTraceabilityRule(ws, rule, readText) {
  if (typeof rule.check === 'function') {
    return rule.check(ws, readText)
  }
  if (rule.requireDirPy && !dirHasPy(path.join(ws, rule.requireDirPy))) {
    return false
  }
  const hay = readText(Array.isArray(rule.dirs) ? rule.dirs : [])
  return rule.pattern instanceof RegExp ? rule.pattern.test(hay) : true
}

function dirHasPy(dir) {
  if (!fs.existsSync(dir)) return false
  return fs.readdirSync(dir).some((f) => f.endsWith('.py') && fs.statSync(path.join(dir, f)).size > 0)
}

const PY_SCAN_SKIP_DIRS = new Set([
  '.venv',
  'venv',
  '.pytest_cache',
  '.stagent',
  '__pycache__',
  'node_modules',
  '.git',
  'site-packages',
])

function collectPyFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) {
      if (PY_SCAN_SKIP_DIRS.has(name)) continue
      collectPyFiles(full, acc)
    } else if (name.endsWith('.py') && st.size > 0) {
      acc.push(full)
    }
  }
  return acc
}

function readWorkspaceText(ws, subdirs) {
  const parts = []
  for (const sub of subdirs) {
    const root = path.join(ws, sub)
    for (const file of collectPyFiles(root)) {
      try {
        parts.push(fs.readFileSync(file, 'utf8'))
      } catch {
        /* skip */
      }
    }
    if (sub === 'tests' && fs.existsSync(root)) {
      for (const f of fs.readdirSync(root)) {
        if (f.endsWith('.py')) {
          try {
            parts.push(fs.readFileSync(path.join(root, f), 'utf8'))
          } catch {
            /* skip */
          }
        }
      }
    }
  }
  return parts.join('\n')
}

function findMainEntry(ws) {
  const candidates = ['main.py', 'cli.py', path.join('src', 'main.py')]
  for (const rel of candidates) {
    const p = path.join(ws, rel)
    if (fs.existsSync(p) && fs.statSync(p).size > 0) return rel
  }
  return null
}

function findTestFiles(ws) {
  const testsDir = path.join(ws, 'tests')
  if (!fs.existsSync(testsDir)) return []
  return fs
    .readdirSync(testsDir)
    .filter((f) => f.startsWith('test_') && f.endsWith('.py'))
    .map((f) => path.join('tests', f))
}

/**
 * 运行 pytest（优先 .venv）。
 * @returns {{ exitCode: number, cmd: string }}
 */
export function runPytestInWorkspace(ws) {
  const venvPy = path.join(ws, '.venv', 'bin', 'python')
  const python = fs.existsSync(venvPy) ? venvPy : 'python3'
  const r = spawnSync(python, ['-m', 'pytest', 'tests/', '-q'], {
    cwd: ws,
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: ws },
  })
  return {
    exitCode: r.status ?? 1,
    cmd: `${python} -m pytest tests/ -q`,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function findFileByBasename(dir, basename) {
  let entries
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return null
  }
  for (const name of entries) {
    const full = path.join(dir, name)
    let st
    try {
      st = fs.statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (PY_SCAN_SKIP_DIRS.has(name)) continue
      const found = findFileByBasename(full, basename)
      if (found) return found
    } else if (name === basename) {
      return full
    }
  }
  return null
}

/**
 * 解析数据/产物文件的真实路径（ADR-0009）：模型可能把 CSV/JSON 放进子目录并在 config.yaml 声明
 * （如 `csv_path: data/tasks.csv`、`output_json_path: output/summary.json`）。门不应硬编码根目录，
 * 否则会误判合法产物。解析顺序：① 字面路径 ② config.yaml 中同 basename 的声明路径 ③ 工作区内递归搜同名文件。
 * @returns {string|null} 绝对路径，找不到返回 null
 */
export function resolveWorkspaceArtifact(ws, declaredRel) {
  const direct = path.join(ws, declaredRel)
  if (fs.existsSync(direct)) return direct
  const base = path.basename(declaredRel)
  const configPath = path.join(ws, 'config.yaml')
  if (fs.existsSync(configPath)) {
    let yaml = ''
    try {
      yaml = fs.readFileSync(configPath, 'utf8')
    } catch {
      yaml = ''
    }
    for (const m of yaml.matchAll(/['"]?([\w./-]+)['"]?/g)) {
      const v = m[1]
      if (v && path.basename(v) === base) {
        const abs = path.isAbsolute(v) ? v : path.join(ws, v)
        if (fs.existsSync(abs)) return abs
      }
    }
  }
  return findFileByBasename(ws, base)
}

/**
 * 「平凡产出」判定（ADR-0008 真实集成冒烟）：递归判断 JSON 值是否全为初始/零值——
 * 数字必须为 0、字符串为空、布尔为 false、null、空数组/对象，或其元素全平凡。
 * 用于捕获「跑完了但产出毫无意义」（如 T6 的 summary 全 0）的空心绿。
 */
export function isTrivialJsonValue(value) {
  if (value === null || value === undefined) return true
  if (typeof value === 'number') return value === 0
  if (typeof value === 'string') return value.trim() === ''
  if (typeof value === 'boolean') return value === false
  if (Array.isArray(value)) return value.every(isTrivialJsonValue)
  if (typeof value === 'object') {
    const vals = Object.values(value)
    return vals.length === 0 || vals.every(isTrivialJsonValue)
  }
  return false
}

/**
 * 评估冒烟产出文件（纯函数，可注入 readFileSync 便于测试）。
 * @param {string} ws
 * @param {{ outputFile?: string, jsonNotAllZero?: boolean, pattern?: RegExp }} smoke
 * @param {(p: string, enc: string) => string} [readFileSync]
 * @returns {{ ok: boolean, error?: string }}
 */
export function evaluateSmokeOutputFile(ws, smoke, readFileSync = fs.readFileSync) {
  if (!smoke || !smoke.outputFile) return { ok: true }
  const outPath = resolveWorkspaceArtifact(ws, smoke.outputFile)
  if (!outPath || !fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
    return { ok: false, error: `smoke 产出缺失/为空：${smoke.outputFile}` }
  }
  const content = readFileSync(outPath, 'utf8')
  if (smoke.jsonNotAllZero) {
    let parsed
    try {
      parsed = JSON.parse(content)
    } catch (e) {
      return { ok: false, error: `smoke 产出非合法 JSON：${smoke.outputFile}（${String(e).slice(0, 120)}）` }
    }
    if (isTrivialJsonValue(parsed)) {
      return { ok: false, error: `smoke 产出无意义（全为零/空值）：${smoke.outputFile}` }
    }
  }
  if (smoke.pattern instanceof RegExp && !smoke.pattern.test(content)) {
    return { ok: false, error: `smoke 产出未命中预期内容：${smoke.outputFile}` }
  }
  return { ok: true }
}

/** 运行 main 入口（优先 .venv），供真实集成冒烟使用。 */
export function runMainEntryInWorkspace(ws) {
  const entry = findMainEntry(ws)
  if (!entry) return { exitCode: 1, error: 'no main entry', cmd: '' }
  const venvPy = path.join(ws, '.venv', 'bin', 'python')
  const python = fs.existsSync(venvPy) ? venvPy : 'python3'
  const r = spawnSync(python, [entry], {
    cwd: ws,
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: ws },
  })
  return {
    exitCode: r.status ?? 1,
    cmd: `${python} ${entry}`,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

/**
 * Fixture 一致性门（ADR-0008 决策3）：校验数据 fixture 的表头/字段覆盖任务声明字段，
 * 捕获「用了别的任务的种子数据」（如 T6 误用 T4 期货 CSV）。
 * @param {string} ws
 * @param {{ file: string, requireColumns?: string[] }[]} fixtures
 * @param {(p: string, enc: string) => string} [readFileSync]
 * @returns {string[]} 错误列表（空 = 通过）
 */
export function evaluateFixtureConsistency(ws, fixtures, readFileSync = fs.readFileSync) {
  if (!Array.isArray(fixtures) || fixtures.length === 0) return []
  const errors = []
  for (const fx of fixtures) {
    if (!fx || !fx.file) continue
    const p = resolveWorkspaceArtifact(ws, fx.file)
    if (!p || !fs.existsSync(p) || fs.statSync(p).size === 0) {
      errors.push(`数据文件缺失/为空：${fx.file}`)
      continue
    }
    if (Array.isArray(fx.requireColumns) && fx.requireColumns.length > 0) {
      const content = readFileSync(p, 'utf8')
      const headerLine = content.split(/\r?\n/).find((l) => l.trim() !== '') ?? ''
      const cols = new Set(
        headerLine
          .split(',')
          .map((c) => c.trim().toLowerCase())
          .filter(Boolean),
      )
      const missing = fx.requireColumns.filter((c) => !cols.has(String(c).trim().toLowerCase()))
      if (missing.length > 0) {
        errors.push(
          `${fx.file} 缺少必需列：${missing.join(', ')}（实际表头：${[...cols].join(', ') || '空'}）`,
        )
      }
    }
  }
  return errors
}

/**
 * 交付前架构扫（ADR-0009）：检测「为过导出契约塞占位符」的烂泥球信号。
 * 命中两类无歧义占位：① 自赋值 `X = X`（如 `PermissionError = PermissionError`）；
 * ② JS 风格别名 `null = None` / `true = True` / `false = False`。
 * @param {string} ws
 * @param {(p: string, enc: string) => string} [readFileSync]
 * @returns {string[]} 错误列表（空 = 通过）
 */
export function evaluatePlaceholderExports(ws, readFileSync = fs.readFileSync) {
  const SELF_ASSIGN_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\1\s*(#.*)?$/
  const JS_ALIAS_RE = /^\s*(null|true|false)\s*=\s*(None|True|False)\s*(#.*)?$/
  const errors = []
  for (const file of collectPyFiles(ws)) {
    let content
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const rel = path.relative(ws, file)
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (SELF_ASSIGN_RE.test(line)) {
        errors.push(`${rel}:${i + 1} 占位自赋值 \`${line.trim()}\`（应实现真实符号，勿为过导出契约塞占位）`)
      } else if (JS_ALIAS_RE.test(line)) {
        errors.push(`${rel}:${i + 1} 无意义别名 \`${line.trim()}\`（JS 风格占位，应删除）`)
      }
    }
  }
  return errors
}

/**
 * 真实集成冒烟（ADR-0008）：用真实依赖跑主路径，并断言产出非平凡。
 * @returns {string[]} 错误列表（空 = 通过）
 */
export function assertSmoke(ws, smoke) {
  if (!smoke) return []
  const errors = []
  if (smoke.run === 'main') {
    const r = runMainEntryInWorkspace(ws)
    if (r.exitCode !== 0) {
      errors.push(`smoke 主入口运行失败（exit ${r.exitCode}）：${(r.stderr || r.error || '').slice(0, 400)}`)
      return errors // 入口没跑起来，产出断言无意义
    }
  }
  const out = evaluateSmokeOutputFile(ws, smoke)
  if (!out.ok) errors.push(out.error)
  return errors
}

/**
 * Strict MVP 验收（T4/T5 量化任务 + T6 确定性平台任务共用）。
 * 量化语义靶子（module dirs / traceability）默认为南华期货；确定性平台任务通过
 * opts.moduleDirs / opts.traceabilityRules 覆盖，使「平台正确性」与「量化语义」解耦
 * （决策记录 D2/D3）。
 * @param {string} ws 工作区根
 * @param {{ outcome?: string, requireTraceability?: boolean, moduleDirs?: string[], traceabilityRules?: object[] }} opts
 */
export function assertStrictMvpPass(ws, opts = {}) {
  const errors = []
  const warnings = []
  const moduleDirs = Array.isArray(opts.moduleDirs) && opts.moduleDirs.length > 0
    ? opts.moduleDirs
    : MVP_MODULE_DIRS
  const traceabilityRules = Array.isArray(opts.traceabilityRules)
    ? opts.traceabilityRules
    : TRACEABILITY_RULES

  if (opts.outcome && opts.outcome !== 'workflowCompleted') {
    errors.push(`strict requires workflowCompleted (got: ${opts.outcome})`)
  }

  const configPath = path.join(ws, 'config.yaml')
  if (!fs.existsSync(configPath) || fs.statSync(configPath).size === 0) {
    errors.push('missing or empty config.yaml')
  }

  for (const dir of moduleDirs) {
    const full = path.join(ws, dir)
    if (!dirHasPy(full)) {
      errors.push(`missing non-empty ${dir}/*.py`)
    }
  }

  if (!findMainEntry(ws)) {
    errors.push('missing main entry (main.py, cli.py, or src/main.py)')
  }

  const tests = findTestFiles(ws)
  if (tests.length === 0) {
    errors.push('missing tests/test_*.py')
  }

  const deliveryPath = path.join(ws, 'DELIVERY.md')
  if (!fs.existsSync(deliveryPath) || fs.statSync(deliveryPath).size === 0) {
    errors.push('missing or empty DELIVERY.md')
  } else {
    const delivery = fs.readFileSync(deliveryPath, 'utf8')
    if (/未实现指数共振/.test(delivery) && /完整.*测试|测试.*正确|全部.*PASSED/i.test(delivery)) {
      warnings.push('DELIVERY.md contradicts: claims full tests but notes missing index resonance')
    }
  }

  const pytest = runPytestInWorkspace(ws)
  if (pytest.exitCode !== 0) {
    errors.push(`pytest failed (exit ${pytest.exitCode}): ${pytest.stderr.slice(0, 400)}`)
  }

  if (opts.requireTraceability !== false) {
    const readText = (subs) => readWorkspaceText(ws, subs)
    for (const rule of traceabilityRules) {
      if (!evaluateTraceabilityRule(ws, rule, readText)) {
        errors.push(`traceability [${rule.id}]: ${rule.hint}`)
      }
    }
  }

  // ADR-0008 决策3：fixture 一致性门——数据文件表头须覆盖任务声明字段（捕获种子污染）。
  if (opts.fixtures) {
    for (const e of evaluateFixtureConsistency(ws, opts.fixtures)) {
      errors.push(`fixture: ${e}`)
    }
  }

  // ADR-0008：真实集成冒烟门——用真实依赖跑主路径并断言产出非平凡（捕获空心绿）。
  if (opts.smoke) {
    for (const e of assertSmoke(ws, opts.smoke)) {
      errors.push(`smoke: ${e}`)
    }
  }

  // ADR-0009：交付前架构扫——检测占位导出（自赋值 / JS 风格别名）等烂泥球。
  if (opts.architectureScan) {
    for (const e of evaluatePlaceholderExports(ws)) {
      errors.push(`arch: ${e}`)
    }
  }

  if (errors.length > 0) {
    throw new Error(`strict MVP acceptance failed:\n- ${errors.join('\n- ')}`)
  }

  return {
    pytestExit: pytest.exitCode,
    testFiles: tests,
    warnings,
  }
}
