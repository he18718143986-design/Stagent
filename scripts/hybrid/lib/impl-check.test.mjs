import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  checkImplNonEmpty,
  dirHasNonEmptyPy,
  fileNonEmpty,
  resolveEmptyImplRetries,
  resolveModuleDirs,
} from './impl-check.mjs'

test('fileNonEmpty / dirHasNonEmptyPy', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-check-'))
  assert.equal(fileNonEmpty(path.join(ws, 'missing.py')), false)

  const main = path.join(ws, 'main.py')
  fs.writeFileSync(main, 'print("ok")\n')
  assert.equal(fileNonEmpty(main), true)

  const modDir = path.join(ws, 'signals')
  fs.mkdirSync(modDir)
  assert.equal(dirHasNonEmptyPy(modDir), false)
  fs.writeFileSync(path.join(modDir, 'gen.py'), 'def run():\n  return 1\n')
  assert.equal(dirHasNonEmptyPy(modDir), true)
})

test('resolveModuleDirs: T4 bundle / tier fallback', () => {
  const dirs = resolveModuleDirs({ mvp: { moduleDirs: ['a', 'b'] } }, 4)
  assert.deepEqual(dirs, ['a', 'b'])
  assert.deepEqual(resolveModuleDirs(null, 4), ['indicators', 'signals', 'risk', 'broker'])
  assert.deepEqual(resolveModuleDirs(null, 7), [])
})

test('resolveEmptyImplRetries: T4=2, T7=1', () => {
  assert.equal(resolveEmptyImplRetries(4, { mvp: { moduleDirs: ['x'] } }), 2)
  assert.equal(resolveEmptyImplRetries(7, { mvp: { moduleDirs: ['x'] } }), 1)
  assert.equal(resolveEmptyImplRetries(7, null), 1)
  assert.equal(resolveEmptyImplRetries(7, { mvp: { moduleDirs: [] } }), 1)
})

test('checkImplNonEmpty: 空工作区 → missing main + modules', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-empty-'))
  const result = checkImplNonEmpty(ws, {
    tier: 4,
    bundle: { mvp: { moduleDirs: ['indicators', 'signals'] } },
  })
  assert.equal(result.pass, false)
  assert.match(result.missing.join('\n'), /main\.py/)
  assert.match(result.missing.join('\n'), /indicators/)
  assert.match(result.missing.join('\n'), /signals/)
  assert.equal(result.implPyCount, 0)
})

test('checkImplNonEmpty: skeleton 齐 → pass', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-ok-'))
  fs.writeFileSync(path.join(ws, 'main.py'), 'def main():\n  pass\n')
  for (const dir of ['indicators', 'signals']) {
    fs.mkdirSync(path.join(ws, dir))
    fs.writeFileSync(path.join(ws, dir, 'mod.py'), 'x = 1\n')
  }
  const result = checkImplNonEmpty(ws, {
    tier: 4,
    bundle: { mvp: { moduleDirs: ['indicators', 'signals'] } },
  })
  assert.equal(result.pass, true)
  assert.equal(result.missing.length, 0)
  assert.ok(result.implPyCount >= 3)
})
