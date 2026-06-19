import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  MVP_MODULE_DIRS,
  evaluateTraceabilityRule,
  assertStrictMvpPass,
  isTrivialJsonValue,
  evaluateSmokeOutputFile,
  assertSmoke,
  evaluateFixtureConsistency,
  evaluatePlaceholderExports,
  resolveWorkspaceArtifact,
  dirHasTs,
  extractCsvPathsFromConfig,
  evaluateSignalsNonZero,
  evaluateHybridGateChecks,
  runStrictGate,
} from './mvp-acceptance.mjs'

function tmpWs() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mvp-acc-test-'))
  return ws
}

function writeFile(ws, rel, content) {
  const full = path.join(ws, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content, 'utf8')
}

function captureError(fn) {
  try {
    fn()
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e))
  }
  throw new Error('expected function to throw')
}

test('evaluateTraceabilityRule: declarative pattern + requireDirPy', () => {
  const ws = tmpWs()
  writeFile(ws, 'store/__init__.py', 'def add(title, priority=3):\n    return 1\n')
  const readText = (subs) => {
    const parts = []
    for (const sub of subs) {
      const dir = path.join(ws, sub)
      if (!fs.existsSync(dir)) continue
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.py')) parts.push(fs.readFileSync(path.join(dir, f), 'utf8'))
      }
    }
    return parts.join('\n')
  }
  const rule = {
    id: 'crud-store',
    dirs: ['store', 'tests'],
    requireDirPy: 'store',
    pattern: /\bdef\s+add\b/,
    hint: 'store/ add',
  }
  assert.equal(evaluateTraceabilityRule(ws, rule, readText), true)

  // requireDirPy 不满足（目录无非空 .py）→ false，即便 pattern 本可命中。
  const ws2 = tmpWs()
  assert.equal(evaluateTraceabilityRule(ws2, rule, () => 'def add():'), false)
})

test('evaluateTraceabilityRule: function-style rule still supported (backward compat)', () => {
  const ws = tmpWs()
  let called = false
  const rule = {
    id: 'fn',
    check: () => {
      called = true
      return true
    },
    hint: 'fn',
  }
  assert.equal(evaluateTraceabilityRule(ws, rule, () => ''), true)
  assert.equal(called, true)
})

test('assertStrictMvpPass: custom moduleDirs/traceability drive the platform target', () => {
  // 不完整的 T6 工作区 → 报错应点名 T6 切片目录与 traceability，而非 T4 量化目录。
  const ws = tmpWs()
  writeFile(ws, 'config.yaml', 'csv_path: data.csv\n')
  const err = captureError(() =>
    assertStrictMvpPass(ws, {
      outcome: 'workflowCompleted',
      moduleDirs: ['models', 'store', 'statemachine', 'pipeline'],
      traceabilityRules: [
        { id: 'crud-store', dirs: ['store'], requireDirPy: 'store', pattern: /def add/, hint: 'store crud' },
      ],
    }),
  )
  const msg = String(err.message)
  assert.match(msg, /missing non-empty store\/\*\.py/)
  assert.match(msg, /missing non-empty statemachine\/\*\.py/)
  assert.match(msg, /traceability \[crud-store\]/)
  // 不得泄漏 T4 量化目录名。
  assert.doesNotMatch(msg, /indicators|signals|broker/)
})

test('assertStrictMvpPass: defaults to the T4 quant target when no spec.mvp given', () => {
  const ws = tmpWs()
  writeFile(ws, 'config.yaml', 'x: 1\n')
  const err = captureError(() => assertStrictMvpPass(ws, { outcome: 'workflowCompleted' }))
  const msg = String(err.message)
  for (const dir of MVP_MODULE_DIRS) {
    assert.match(msg, new RegExp(`missing non-empty ${dir}/\\*\\.py`))
  }
})

// ADR-0008 真实集成冒烟：平凡产出判定
test('isTrivialJsonValue: all-zero summary is trivial (would catch T6 空心绿)', () => {
  assert.equal(isTrivialJsonValue({ todo: 0, in_progress: 0, done: 0, cancelled: 0 }), true)
  assert.equal(isTrivialJsonValue({}), true)
  assert.equal(isTrivialJsonValue([]), true)
  assert.equal(isTrivialJsonValue(0), true)
  assert.equal(isTrivialJsonValue(''), true)
  assert.equal(isTrivialJsonValue(null), true)
  // 非平凡
  assert.equal(isTrivialJsonValue({ todo: 2, in_progress: 1, done: 0, cancelled: 0 }), false)
  assert.equal(isTrivialJsonValue({ imported: 3 }), false)
  assert.equal(isTrivialJsonValue('hello'), false)
})

test('evaluateSmokeOutputFile: T6 all-zero summary fails the smoke gate', () => {
  const ws = tmpWs()
  writeFile(ws, 'summary.json', JSON.stringify({ todo: 0, in_progress: 0, done: 0, cancelled: 0 }))
  const r = evaluateSmokeOutputFile(ws, { outputFile: 'summary.json', jsonNotAllZero: true })
  assert.equal(r.ok, false)
  assert.match(String(r.error), /无意义|全为零/)
})

test('evaluateSmokeOutputFile: meaningful summary passes', () => {
  const ws = tmpWs()
  writeFile(ws, 'summary.json', JSON.stringify({ todo: 2, in_progress: 1, done: 0, cancelled: 0 }))
  assert.equal(evaluateSmokeOutputFile(ws, { outputFile: 'summary.json', jsonNotAllZero: true }).ok, true)
})

test('evaluateSmokeOutputFile: missing / empty / non-JSON output fails', () => {
  const ws = tmpWs()
  assert.equal(evaluateSmokeOutputFile(ws, { outputFile: 'summary.json', jsonNotAllZero: true }).ok, false)
  writeFile(ws, 'out.json', '   ')
  assert.equal(evaluateSmokeOutputFile(ws, { outputFile: 'out.json', jsonNotAllZero: true }).ok, false)
  writeFile(ws, 'bad.json', 'not json{')
  assert.equal(evaluateSmokeOutputFile(ws, { outputFile: 'bad.json', jsonNotAllZero: true }).ok, false)
})

test('assertSmoke: command 模式执行自定义冒烟命令', () => {
  const ws = tmpWs()
  writeFile(ws, 'smoke_cmd.py', `import os, sys\nos.makedirs('output', exist_ok=True)\nif '--smoke' in sys.argv:\n    open('output/smoke_report.json','w').write('{"n":1}')\n`)
  const errs = assertSmoke(ws, {
    run: 'command',
    command: ['python', 'smoke_cmd.py', '--smoke'],
    outputFile: 'output/smoke_report.json',
    jsonNotAllZero: true,
  })
  assert.deepEqual(errs, [])
})

test('assertStrictMvpPass: requiredFiles 检查', () => {
  const ws = tmpWs()
  writeFile(ws, 'config.yaml', 'x: 1\n')
  writeFile(ws, 'DELIVERY.md', 'ok\n')
  writeFile(ws, 'main.py', 'print(1)\n')
  writeFile(ws, 'tests/test_x.py', 'def test_ok(): pass\n')
  assert.throws(
    () =>
      assertStrictMvpPass(ws, {
        moduleDirs: [],
        requiredFiles: ['app.py', 'models.py'],
        requireTraceability: false,
        smoke: undefined,
      }),
    /missing or empty required file: app.py/,
  )
})

// ADR-0008 决策3：fixture 一致性门
test('evaluateFixtureConsistency: T4 期货 CSV 用于 todo 任务 → 缺列被拦', () => {
  const ws = tmpWs()
  writeFile(ws, 'tasks.csv', 'timestamp,open,high,low,close,volume\n2023-01-02,4000,4010,3990,4005,1000\n')
  const errs = evaluateFixtureConsistency(ws, [
    { file: 'tasks.csv', requireColumns: ['title', 'priority', 'status'] },
  ])
  assert.equal(errs.length, 1)
  assert.match(errs[0], /缺少必需列/)
  assert.match(errs[0], /title/)
})

test('evaluateFixtureConsistency: 正确表头通过', () => {
  const ws = tmpWs()
  writeFile(ws, 'tasks.csv', 'title,priority,status\nBuy milk,2,todo\n')
  assert.deepEqual(
    evaluateFixtureConsistency(ws, [
      { file: 'tasks.csv', requireColumns: ['title', 'priority', 'status'] },
    ]),
    [],
  )
})

test('evaluateFixtureConsistency: 缺文件 / 空规格', () => {
  const ws = tmpWs()
  const errs = evaluateFixtureConsistency(ws, [{ file: 'missing.csv', requireColumns: ['title'] }])
  assert.equal(errs.length, 1)
  assert.match(errs[0], /缺失|为空/)
  assert.deepEqual(evaluateFixtureConsistency(ws, undefined), [])
  assert.deepEqual(evaluateFixtureConsistency(ws, []), [])
})

// ADR-0009：交付前架构扫——占位导出检测
test('evaluatePlaceholderExports: 占位自赋值与 JS 别名被拦，真实实现/第三方目录不误报', () => {
  const ws = tmpWs()
  writeFile(ws, 'main.py', 'PermissionError = PermissionError\nnull = None\n\ndef main():\n    pass\n')
  writeFile(ws, 'store/__init__.py', 'class S:\n    def add(self, t, p=3):\n        return 1\n')
  writeFile(ws, '.venv/lib/site-packages/foo.py', 'Bar = Bar\n')
  const errs = evaluatePlaceholderExports(ws)
  assert.equal(errs.length, 2)
  assert.ok(errs.some((e) => /PermissionError = PermissionError/.test(e)))
  assert.ok(errs.some((e) => /null = None/.test(e)))
  assert.ok(errs.every((e) => e.startsWith('main.py:')))
})

// ADR-0009：门按 config.yaml 解析子目录路径（B70j8N：data/tasks.csv + output/summary.json）
test('resolveWorkspaceArtifact: 解析 config.yaml 声明的子目录路径', () => {
  const ws = tmpWs()
  writeFile(ws, 'config.yaml', 'csv_path: data/tasks.csv\noutput_json_path: output/summary.json\n')
  writeFile(ws, 'data/tasks.csv', 'title,priority,status\nA,2,todo\n')
  const resolved = resolveWorkspaceArtifact(ws, 'tasks.csv')
  assert.ok(resolved && resolved.endsWith(path.join('data', 'tasks.csv')))
  assert.equal(resolveWorkspaceArtifact(ws, 'summary.json'), null)
})

test('evaluateFixtureConsistency: 子目录 CSV（config 声明）按真实路径校验', () => {
  const ws = tmpWs()
  writeFile(ws, 'config.yaml', 'csv_path: data/tasks.csv\n')
  writeFile(ws, 'data/tasks.csv', 'title,priority,status\nA,2,todo\n')
  assert.deepEqual(
    evaluateFixtureConsistency(ws, [{ file: 'tasks.csv', requireColumns: ['title', 'priority', 'status'] }]),
    [],
  )
})

// ADR-0005 附录 B：Node/TS 支持（requireDirTs，T6n 前置）
test('dirHasTs: 含非空 .ts → true；空目录/空文件 → false', () => {
  const ws = tmpWs()
  // 含非空 .ts
  writeFile(ws, 'src/store/store.ts', 'export function add() { return 1 }\n')
  assert.equal(dirHasTs(path.join(ws, 'src/store')), true)
  // 空目录（不存在）
  assert.equal(dirHasTs(path.join(ws, 'src/empty')), false)
  // 空文件（size 0）
  writeFile(ws, 'src/zero/zero.ts', '')
  assert.equal(dirHasTs(path.join(ws, 'src/zero')), false)
})

test('evaluateTraceabilityRule: declarative pattern + requireDirTs (node)', () => {
  const ws = tmpWs()
  writeFile(ws, 'src/store/store.ts', 'export function add(title: string) { return 1 }\n')
  const readText = (subs) => {
    const parts = []
    for (const sub of subs) {
      const dir = path.join(ws, sub)
      if (!fs.existsSync(dir)) continue
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.ts')) parts.push(fs.readFileSync(path.join(dir, f), 'utf8'))
      }
    }
    return parts.join('\n')
  }
  const rule = {
    id: 'crud-store',
    dirs: ['src/store', 'tests'],
    requireDirTs: 'src/store',
    pattern: /\bfunction\s+add\b/,
    hint: 'src/store add',
  }
  assert.equal(evaluateTraceabilityRule(ws, rule, readText), true)

  // requireDirTs 不满足（目录无非空 .ts）→ false，即便 pattern 本可命中。
  const ws2 = tmpWs()
  assert.equal(evaluateTraceabilityRule(ws2, rule, () => 'function add() {}'), false)
})

test('assertStrictMvpPass language:node: 完整 Node/TS 工作区不抛', () => {
  const ws = tmpWs()
  writeFile(ws, 'config.json', '{"name":"todo"}\n')
  writeFile(ws, 'src/store/store.ts', 'export function add(title: string, priority = 3) { return 1 }\n')
  writeFile(ws, 'src/main.ts', 'import { add } from "./store/store"\nadd("x")\n')
  writeFile(ws, 'tests/store.test.ts', 'import { add } from "../src/store/store"\nadd("x")\n')
  writeFile(ws, 'DELIVERY.md', '# Delivery\n')
  assert.doesNotThrow(() =>
    assertStrictMvpPass(ws, {
      outcome: 'workflowCompleted',
      language: 'node',
      moduleDirs: ['src/store'],
      traceabilityRules: [
        {
          id: 'crud-store',
          dirs: ['src/store', 'tests'],
          requireDirTs: 'src/store',
          pattern: /add/,
          hint: 'src/store add',
        },
      ],
    }),
  )
})

test('assertStrictMvpPass language:node: 报错点名缺失项（.ts 模块/主入口/tests/config.json）', () => {
  // 缺 .ts 模块目录 → missing non-empty <dir>/*.ts
  const wsModule = tmpWs()
  writeFile(wsModule, 'config.json', '{}\n')
  writeFile(wsModule, 'src/main.ts', 'export {}\n')
  writeFile(wsModule, 'tests/store.test.ts', 'test()\n')
  writeFile(wsModule, 'DELIVERY.md', '# d\n')
  const errModule = captureError(() =>
    assertStrictMvpPass(wsModule, { outcome: 'workflowCompleted', language: 'node', moduleDirs: ['src/store'], requireTraceability: false }),
  )
  assert.match(String(errModule.message), /missing non-empty src\/store\/\*\.ts/)

  // 缺 main 入口 → missing main entry (src/main.ts, main.ts, cli.ts, or src/index.ts)
  const wsMain = tmpWs()
  writeFile(wsMain, 'config.json', '{}\n')
  writeFile(wsMain, 'src/store/store.ts', 'export function add() { return 1 }\n')
  writeFile(wsMain, 'tests/store.test.ts', 'test()\n')
  writeFile(wsMain, 'DELIVERY.md', '# d\n')
  const errMain = captureError(() =>
    assertStrictMvpPass(wsMain, { outcome: 'workflowCompleted', language: 'node', moduleDirs: ['src/store'], requireTraceability: false }),
  )
  assert.match(String(errMain.message), /missing main entry \(src\/main\.ts, main\.ts, cli\.ts, or src\/index\.ts\)/)

  // 缺 tests → missing tests/*.test.ts (or *.spec.ts)
  const wsTests = tmpWs()
  writeFile(wsTests, 'config.json', '{}\n')
  writeFile(wsTests, 'src/store/store.ts', 'export function add() { return 1 }\n')
  writeFile(wsTests, 'src/main.ts', 'export {}\n')
  writeFile(wsTests, 'DELIVERY.md', '# d\n')
  const errTests = captureError(() =>
    assertStrictMvpPass(wsTests, { outcome: 'workflowCompleted', language: 'node', moduleDirs: ['src/store'], requireTraceability: false }),
  )
  assert.match(String(errTests.message), /missing tests\/\*\.test\.ts \(or \*\.spec\.ts\)/)

  // 缺 config.json → missing or empty config.json
  const wsConfig = tmpWs()
  writeFile(wsConfig, 'src/store/store.ts', 'export function add() { return 1 }\n')
  writeFile(wsConfig, 'src/main.ts', 'export {}\n')
  writeFile(wsConfig, 'tests/store.test.ts', 'test()\n')
  writeFile(wsConfig, 'DELIVERY.md', '# d\n')
  const errConfig = captureError(() =>
    assertStrictMvpPass(wsConfig, { outcome: 'workflowCompleted', language: 'node', moduleDirs: ['src/store'], requireTraceability: false }),
  )
  assert.match(String(errConfig.message), /missing or empty config\.json/)
})

test('assertStrictMvpPass: 默认（不传 language）仍按 Python 报 missing non-empty <dir>/*.py', () => {
  const ws = tmpWs()
  writeFile(ws, 'config.yaml', 'x: 1\n')
  const err = captureError(() => assertStrictMvpPass(ws, { outcome: 'workflowCompleted', moduleDirs: ['store'], requireTraceability: false }))
  const msg = String(err.message)
  assert.match(msg, /missing non-empty store\/\*\.py/)
  // 仍走 Python 主入口/tests/config 文案，不得出现 Node 文案。
  assert.match(msg, /missing main entry \(app\.py, main\.py, cli\.py, or src\/main\.py\)/)
  assert.match(msg, /missing tests\/test_\*\.py/)
  assert.doesNotMatch(msg, /\*\.ts|config\.json/)
})

test('extractCsvPathsFromConfig: 解析引号内 csv 路径', () => {
  const ws = tmpWs()
  writeFile(ws, 'config.yaml', "data_path: 'fixtures/kline.csv'\nindex: \"data/index.csv\"\n")
  assert.deepEqual(extractCsvPathsFromConfig(ws).sort(), ['data/index.csv', 'fixtures/kline.csv'])
})

test('evaluateSignalsNonZero: summary open_long+open_short', () => {
  const ws = tmpWs()
  writeFile(ws, 'backtest_summary.json', JSON.stringify({ open_long: 1, open_short: 0 }))
  assert.equal(evaluateSignalsNonZero(ws, 1), null)
  writeFile(ws, 'backtest_summary.json', JSON.stringify({ open_long: 0, open_short: 0 }))
  assert.match(evaluateSignalsNonZero(ws, 1), /至少 1 条/)
})

test('evaluateHybridGateChecks: G-no-ctp 拦截 openctp', () => {
  const ws = tmpWs()
  writeFile(ws, 'requirements.txt', 'openctp-ctp\n')
  const { errors, checks } = evaluateHybridGateChecks(ws, { forbidCtp: true })
  assert.ok(errors.some((e) => e.startsWith('G-no-ctp:')))
  assert.equal(checks.find((c) => c.id === 'G-no-ctp')?.pass, false)
})

test('runStrictGate: hybrid 检查不重复计入 errors', () => {
  const ws = tmpWs()
  writeFile(ws, 'config.yaml', "csv: 'missing.csv'\n")
  const report = runStrictGate(ws, {
    outcome: 'workflowCompleted',
    moduleDirs: ['indicators'],
    requireTraceability: false,
    hybridGate: { requireFixturesOnDisk: true, forbidCtp: true },
  })
  const fixtureFails = report.errors.filter((e) => e.startsWith('G-fixtures-on-disk:'))
  assert.equal(fixtureFails.length, 1)
})
