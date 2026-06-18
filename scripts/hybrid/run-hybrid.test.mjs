import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { runHybridPipeline } from './run-hybrid.mjs'

test('runHybridPipeline --mock: export + gate，不调用 CodeAct', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-mock-'))
  const report = runHybridPipeline({
    tier: 4,
    workspace: ws,
    mock: true,
    runId: 'test-mock',
  })

  assert.equal(report.pass, false)
  assert.equal(report.tier, 4)
  assert.ok(fs.existsSync(path.join(ws, '.stagent-bundle', 'task.json')))
  assert.ok(fs.existsSync(path.join(ws, 'artifacts', 'gate-report.json')))
  assert.equal(report.attempts.length, 1)
  assert.equal(report.attempts[0].codeact.skipped, true)
  assert.equal(report.attempts[0].codeact.reason, 'mock')
})

test('runHybridPipeline: gate-only 无 bundle 时仍可按 tier 跑 gate', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-gate-tier-'))
  const report = runHybridPipeline({
    tier: 7,
    workspace: ws,
    skipExport: true,
    skipCodeact: true,
    runId: 'test-gate-tier',
  })
  assert.equal(report.pass, false)
  assert.equal(report.attempts.length, 1)
  assert.ok(fs.existsSync(path.join(ws, 'artifacts', 'gate-report.json')))
})
