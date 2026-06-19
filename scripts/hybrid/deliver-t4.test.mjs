import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { runDeliverT4 } from './deliver-t4.mjs'

test('runDeliverT4 --mock: seeds fixtures + export + gate', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'deliver-t4-mock-'))
  const report = runDeliverT4({
    workspace: ws,
    mock: true,
    force: true,
    runId: 'test-deliver-mock',
  })

  assert.equal(report.tier, 4)
  assert.equal(report.pass, false)
  assert.ok(fs.existsSync(path.join(ws, 'data/bars_3m.csv')))
  assert.ok(fs.existsSync(path.join(ws, 'config.yaml')))
  assert.ok(fs.existsSync(path.join(ws, '.stagent-bundle', 'task.json')))
  assert.ok(fs.existsSync(path.join(ws, 'artifacts', 'gate-report.json')))
  assert.equal(report.attempts[0].codeact.skipped, true)
})
