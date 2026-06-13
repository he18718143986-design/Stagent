const fs = require('node:fs')
const path = require('node:path')

const snapshotPath = process.argv[2] || path.resolve(process.cwd(), 'artifacts/failure-snapshot.json')
if (!fs.existsSync(snapshotPath)) {
  console.error(`snapshot not found: ${snapshotPath}`)
  process.exit(1)
}

const raw = fs.readFileSync(snapshotPath, 'utf8')
const data = JSON.parse(raw)
const gate = data.gate || { passed: true, observedFailures: 0, observedUnknown: 0 }
if (!gate.passed) {
  console.error(`adapter gates failed: failures=${gate.observedFailures}, unknown=${gate.observedUnknown}`)
  process.exit(2)
}
console.log(`adapter gates passed: failures=${gate.observedFailures}, unknown=${gate.observedUnknown}`)

