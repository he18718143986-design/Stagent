const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const artifactsDir = path.resolve(process.cwd(), 'artifacts')
const runLog = path.join(artifactsDir, 'regression-loop.log')
fs.mkdirSync(artifactsDir, { recursive: true })

function runStep(name, command, args) {
  const started = Date.now()
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
  })
  const summary = [
    `# ${name}`,
    `exitCode=${result.status == null ? 1 : result.status}`,
    `elapsedMs=${Date.now() - started}`,
    '--- stdout ---',
    result.stdout || '',
    '--- stderr ---',
    result.stderr || '',
    '',
  ].join('\n')
  fs.appendFileSync(runLog, summary, 'utf8')
  return result.status == null ? 1 : result.status
}

fs.writeFileSync(runLog, '', 'utf8')
const typecheckCode = runStep('typecheck', 'npm', ['run', 'typecheck'])
const testCode = runStep('test', 'npm', ['run', 'test'])
const docsCode = runStep('docs-links', 'node', ['scripts/check-docs-links.mjs'])

const extract = spawnSync(
  'node',
  ['scripts/extract-failure-snapshot.js', runLog, path.join(artifactsDir, 'failure-snapshot.json')],
  { cwd: process.cwd(), env: process.env, encoding: 'utf8' },
)
process.stdout.write(extract.stdout || '')
process.stderr.write(extract.stderr || '')

if (typecheckCode !== 0 || testCode !== 0 || docsCode !== 0) {
  process.exit(1)
}
if ((extract.status == null ? 1 : extract.status) !== 0) {
  process.exit(extract.status == null ? 1 : extract.status)
}
const gates = spawnSync(
  'node',
  ['scripts/check-adapter-gates.js', path.join(artifactsDir, 'failure-snapshot.json')],
  { cwd: process.cwd(), env: process.env, encoding: 'utf8' },
)
process.stdout.write(gates.stdout || '')
process.stderr.write(gates.stderr || '')
if ((gates.status == null ? 1 : gates.status) !== 0) {
  process.exit(gates.status == null ? 1 : gates.status)
}

console.log(`regression loop passed, log: ${runLog}`)

