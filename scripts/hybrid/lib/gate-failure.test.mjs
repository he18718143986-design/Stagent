import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
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
