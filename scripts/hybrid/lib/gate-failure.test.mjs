import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  buildEmptyImplFixPrompt,
  buildFixPrompt,
  classifyGateFailure,
  writeFixPromptFile,
} from './gate-failure.mjs'

test('classifyGateFailure: pytest 缺失 → gate_infra', () => {
  const cat = classifyGateFailure({
    errors: ['pytest failed (exit 1): No module named pytest'],
  })
  assert.equal(cat, 'gate_infra')
})

test('classifyGateFailure: G-signals → implementation', () => {
  const cat = classifyGateFailure({
    errors: ['G-signals-nonzero: 需要至少 1 条 OPEN_LONG/OPEN_SHORT 信号'],
  })
  assert.equal(cat, 'implementation')
})

test('buildFixPrompt: T4 G-signals + DELIVERY 定向清单', () => {
  const text = buildFixPrompt({
    checks: [
      { id: 'G-signals-nonzero', pass: false, message: '需要至少 1 条 OPEN_LONG/OPEN_SHORT 信号' },
      { id: 'mvp', pass: false, message: 'missing or empty DELIVERY.md' },
      { id: 'mvp', pass: false, message: 'pytest failed (exit 1):' },
    ],
  }, 2)
  assert.match(text, /DELIVERY\.md/)
  assert.match(text, /G-signals-nonzero|信号产出/)
  assert.match(text, /OPEN_LONG/)
  assert.match(text, /pytest -q/)
  assert.match(text, /第 2 轮回流/)
})

test('buildFixPrompt: 列出失败 checks', () => {
  const text = buildFixPrompt({
    checks: [
      { id: 'G-fixtures-on-disk', pass: false, message: '缺失 data/bars_3m.csv' },
      { id: 'mvp', pass: true, message: 'ok' },
    ],
  })
  assert.match(text, /G-fixtures-on-disk/)
  assert.match(text, /缺失 data\/bars_3m\.csv/)
})

test('writeFixPromptFile: 写入 artifacts/fix_prompt.md', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-prompt-'))
  const dest = writeFixPromptFile(ws, '# fix\n')
  assert.equal(dest, path.join(ws, 'artifacts', 'fix_prompt.md'))
  assert.ok(fs.existsSync(dest))
})

test('buildEmptyImplFixPrompt: 空 impl 清单 + skeleton 指令', () => {
  const text = buildEmptyImplFixPrompt(
    {
      missing: ['main.py（无参可运行的入口，非空）', 'signals/（至少一个非空 .py 模块）'],
      moduleDirs: ['indicators', 'signals', 'risk', 'broker'],
      implPyCount: 0,
    },
    1,
  )
  assert.match(text, /空 impl 早退回流/)
  assert.match(text, /main\.py/)
  assert.match(text, /signals/)
  assert.match(text, /skeleton/)
  assert.match(text, /禁止只写 Markdown 计划/)
  assert.match(text, /indicators/)
})
