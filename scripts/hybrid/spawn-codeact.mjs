#!/usr/bin/env node
/**
 * Spawn stagent-codeact runner (Scheme A venv).
 * Usage: node scripts/hybrid/spawn-codeact.mjs --bundle .stagent-bundle --workspace ./ws
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

import { spawnCodeAct, VENV_CLI } from './lib/spawn-codeact-core.mjs'

function parseArgs(argv) {
  const out = { bundle: null, workspace: null, fixPrompt: null, eventsOut: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--bundle') out.bundle = argv[++i]
    else if (a === '--workspace') out.workspace = argv[++i]
    else if (a === '--fix-prompt') out.fixPrompt = argv[++i]
    else if (a === '--events-out') out.eventsOut = argv[++i]
  }
  return out
}

const { bundle, workspace, fixPrompt, eventsOut } = parseArgs(process.argv.slice(2))
if (!bundle || !workspace) {
  console.error(
    'Usage: spawn-codeact.mjs --bundle <dir> --workspace <dir> [--fix-prompt file] [--events-out file]',
  )
  process.exit(2)
}

if (!fs.existsSync(VENV_CLI)) {
  console.error('CodeAct venv missing. Run: npm run codeact:install')
  process.exit(1)
}

const r = spawnCodeAct({
  bundle: path.resolve(bundle),
  workspace: path.resolve(workspace),
  fixPromptPath: fixPrompt,
  eventsOut: eventsOut ? path.resolve(eventsOut) : null,
  inheritStdio: !eventsOut,
})

if (r.error) {
  console.error(r.error)
  process.exit(1)
}
process.exit(r.exitCode)
