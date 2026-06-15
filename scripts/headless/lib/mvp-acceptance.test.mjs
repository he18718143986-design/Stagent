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
  evaluateFixtureConsistency,
  evaluatePlaceholderExports,
  resolveWorkspaceArtifact,
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

test('evaluateSmokeOutputFile: no smoke spec → ok (backward compatible)', () => {
  const ws = tmpWs()
  assert.equal(evaluateSmokeOutputFile(ws, undefined).ok, true)
  assert.equal(evaluateSmokeOutputFile(ws, {}).ok, true)
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
