#!/usr/bin/env node
/**
 * L4 — Gate 空心绿回归：golden 夹具必须 discriminating（pass vs fail）。
 */
import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { evaluateHybridGateChecks } from '../headless/lib/mvp-acceptance.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const GOLDEN = path.join(REPO_ROOT, 'examples/golden')

const T4_HYBRID_GATE = {
  requireFixturesOnDisk: true,
  requireDefaultMainExit0: true,
  minSignals: 1,
  forbidCtp: true,
  requireE2eTest: true,
}

test('golden hollow-green-fail: gate must FAIL (G-signals / fixtures)', () => {
  const ws = path.join(GOLDEN, 'hollow-green-fail')
  assert.ok(fs.existsSync(ws), `missing ${ws}`)
  const hybrid = evaluateHybridGateChecks(ws, T4_HYBRID_GATE)
  assert.ok(hybrid.errors.length > 0, 'hollow workspace must fail hybrid G-* checks')
  const failedIds = hybrid.checks.filter((c) => !c.pass).map((c) => c.id)
  assert.ok(
    failedIds.some((id) => id.startsWith('G-')),
    `expected G-* failure, got: ${failedIds.join(', ')}`,
  )
})

test('golden discriminating-pass-minimal: hybrid G-* checks must PASS', () => {
  const ws = path.join(GOLDEN, 'discriminating-pass-minimal')
  assert.ok(fs.existsSync(ws), `missing ${ws}`)
  const hybrid = evaluateHybridGateChecks(ws, T4_HYBRID_GATE)
  assert.equal(hybrid.errors.length, 0, hybrid.errors.join('; '))
  for (const c of hybrid.checks) {
    assert.equal(c.pass, true, `${c.id}: ${c.message}`)
  }
})
