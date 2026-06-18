import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  buildTaskJson,
  parseTierArg,
  resolveBundleProfile,
  serializeTraceabilityRules,
  TEMPLATES_DIR,
} from './bundle-profiles.mjs'
import { TRACEABILITY_RULES } from '../headless/lib/mvp-acceptance.mjs'
import { exportTaskBundle } from './task-bundle.mjs'

test('parseTierArg: t4 / 7', () => {
  assert.equal(parseTierArg('t4'), 4)
  assert.equal(parseTierArg('7'), 7)
})

test('buildTaskJson: T4 含 traceability 与 codeact', () => {
  const { spec } = resolveBundleProfile(4)
  const task = buildTaskJson({ tier: 4, spec })
  assert.equal(task.version, 1)
  assert.equal(task.tier, 4)
  assert.deepEqual(task.mvp.moduleDirs, ['indicators', 'signals', 'risk', 'broker'])
  assert.ok(Array.isArray(task.mvp.traceability))
  assert.equal(task.codeact.forbiddenPatterns.includes('openctp'), true)
})

test('buildTaskJson: T7 继承 live-tasks mvp', () => {
  const { spec } = resolveBundleProfile(7)
  const task = buildTaskJson({ tier: 7, spec })
  assert.deepEqual(task.mvp.moduleDirs, spec.mvp.moduleDirs)
  assert.ok(task.mvp.traceability?.length > 0)
})

test('exportTaskBundle: T4 写出 bundle 结构与 seed', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-export-'))
  const bundleDir = path.join(ws, '.stagent-bundle')

  const result = exportTaskBundle({
    tier: 4,
    bundleDir,
    workspaceDir: ws,
    force: true,
    dryRun: false,
  })

  assert.equal(result.taskId, 'live-t4-nanhua-futures')
  assert.ok(fs.existsSync(path.join(bundleDir, 'task.json')))
  assert.ok(fs.existsSync(path.join(bundleDir, 'OPENHANDS_PROMPT.md')))
  assert.ok(fs.existsSync(path.join(bundleDir, '期货策略-可验收回测规格.md')))
  assert.ok(fs.existsSync(path.join(bundleDir, 'config.contract.yaml')))
  assert.ok(fs.existsSync(path.join(ws, 'tests/test_e2e_signal.py')))
  assert.ok(fs.existsSync(path.join(ws, 'scripts/acceptance.sh')))

  const task = JSON.parse(fs.readFileSync(path.join(bundleDir, 'task.json'), 'utf8'))
  assert.ok(task.specRefs.includes('期货策略-可验收回测规格.md'))
})

test('exportTaskBundle: T7 无 test_e2e_signal', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-export-t7-'))
  const bundleDir = path.join(ws, '.stagent-bundle')

  exportTaskBundle({
    tier: 7,
    bundleDir,
    workspaceDir: ws,
    force: true,
    dryRun: false,
  })

  assert.ok(fs.existsSync(path.join(bundleDir, 'task.json')))
  assert.ok(fs.existsSync(path.join(ws, 'scripts/acceptance.sh')))
  assert.equal(fs.existsSync(path.join(ws, 'tests/test_e2e_signal.py')), false)
})

test('serializeTraceabilityRules: RegExp → JSON-safe', () => {
  const out = serializeTraceabilityRules(TRACEABILITY_RULES)
  assert.ok(out[0].pattern.source)
  assert.equal(out[0].pattern.flags, 'i')
})

test('templates: t4/t6/t7 目录存在', () => {
  for (const id of ['t4', 't6', 't7']) {
    assert.ok(fs.existsSync(path.join(TEMPLATES_DIR, id, 'config.contract.yaml')))
  }
})
