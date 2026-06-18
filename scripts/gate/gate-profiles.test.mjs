import { test } from 'node:test'
import * as assert from 'node:assert/strict'

import { parseTaskArg, resolveStrictGateOpts } from './gate-profiles.mjs'

test('parseTaskArg: t4 / 4 / T6', () => {
  assert.equal(parseTaskArg('t4'), 4)
  assert.equal(parseTaskArg('4'), 4)
  assert.equal(parseTaskArg('T6'), 6)
})

test('resolveStrictGateOpts: T4 含完整 hybridGate', () => {
  const opts = resolveStrictGateOpts({ tier: 4 })
  assert.equal(opts.taskId, 'live-t4-nanhua-futures')
  assert.ok(opts.hybridGate)
  assert.equal(opts.hybridGate.requireFixturesOnDisk, true)
  assert.equal(opts.hybridGate.requireE2eTest, true)
  assert.equal(opts.hybridGate.minSignals, 1)
})

test('resolveStrictGateOpts: T6 继承 mvp.smoke + 轻量 hybrid', () => {
  const opts = resolveStrictGateOpts({ tier: 6 })
  assert.equal(opts.taskId, 'live-t6-deterministic-platform')
  assert.ok(opts.smoke)
  assert.equal(opts.hybridGate.forbidCtp, true)
  assert.equal(opts.hybridGate.requireFixturesOnDisk, undefined)
})

test('resolveStrictGateOpts: bundle 覆盖 taskId', () => {
  const opts = resolveStrictGateOpts({
    tier: 7,
    bundle: { taskId: 'custom-t7', mvp: { moduleDirs: ['models'] } },
  })
  assert.equal(opts.taskId, 'custom-t7')
  assert.deepEqual(opts.moduleDirs, ['models'])
})
