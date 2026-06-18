import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'

import { buildSpawnArgs } from './spawn-codeact-core.mjs'

test('buildSpawnArgs uses --fix-prompt-file for long gate reports', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stagent-fix-'))
  const fixPath = path.join(tmp, 'fix.md')
  fs.writeFileSync(fixPath, 'x'.repeat(5000), 'utf8')
  const bundle = path.join(tmp, 'bundle')
  const workspace = path.join(tmp, 'ws')
  fs.mkdirSync(bundle)
  fs.mkdirSync(workspace)

  const args = buildSpawnArgs({ bundle, workspace, fixPromptPath: fixPath })
  assert.ok(args.includes('--fix-prompt-file'))
  assert.equal(args[args.indexOf('--fix-prompt-file') + 1], path.resolve(fixPath))
  assert.ok(!args.includes('--fix-prompt'))

  fs.rmSync(tmp, { recursive: true, force: true })
})
