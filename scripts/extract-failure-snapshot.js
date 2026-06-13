const fs = require('node:fs')
const path = require('node:path')

const inputLog = process.argv[2]
if (!inputLog) {
  console.error('Usage: node scripts/extract-failure-snapshot.js <log-file> [out-file]')
  process.exit(1)
}

const outFile = process.argv[3] || path.resolve(process.cwd(), 'artifacts/failure-snapshot.json')
const raw = fs.readFileSync(inputLog, 'utf8')
const lines = raw.split(/\r?\n/)

const FIELD_RE = /\b(sendSeq|siteId|stage|path|retryable|errorCode|code)\s*[:=]\s*["']?([A-Za-z0-9._:-]+)["']?/g

function extractFields(line) {
  const out = {}
  let m = FIELD_RE.exec(line)
  while (m) {
    const key = m[1]
    const value = m[2]
    out[key] = value
    m = FIELD_RE.exec(line)
  }
  FIELD_RE.lastIndex = 0
  return out
}

function inferEvent(line, fields) {
  const lower = line.toLowerCase()
  let errorCode = fields.errorCode || fields.code
  let stage = fields.stage
  let retryable = fields.retryable === 'true' ? true : fields.retryable === 'false' ? false : undefined
  let pathName = fields.path

  if (!pathName) {
    if (lower.includes('playwright')) pathName = 'playwright'
    else if (lower.includes('legacy')) pathName = 'legacy'
  }
  if (!stage) {
    if (lower.includes('inject failed')) stage = 'inject'
    else if (lower.includes('network')) stage = 'network'
    else if (lower.includes('reply settled') || lower.includes('racereply error')) stage = 'settle'
    else stage = 'send'
  }
  if (!errorCode) {
    if (lower.includes('no-bound-cdp-page')) errorCode = 'PW_NO_BOUND_PAGE'
    else if (lower.includes('connectovercdp-failed')) errorCode = 'PW_CDP_CONNECT_FAILED'
    else if (lower.includes('author-label')) errorCode = 'DOM_AUTHOR_LABEL_ONLY'
    else if (lower.includes('timed-out') || lower.includes('timeout')) errorCode = 'TIMEOUT_EMPTY_BODY'
    else if (lower.includes('inject failed')) errorCode = 'INJECT_FAILED'
    else if (lower.includes('racereply error')) errorCode = 'RACE_REPLY_ERROR'
    else errorCode = 'UNKNOWN'
  }
  if (retryable == null) {
    retryable = !['RACE_REPLY_ERROR', 'CERT_OR_PROXY_ANOMALY', 'NAVIGATION_INTERRUPTED'].includes(errorCode)
  }

  return {
    ts: Date.now(),
    eventType: 'failure',
    errorCode,
    stage,
    sendSeq: fields.sendSeq || null,
    path: pathName || 'unknown',
    siteId: fields.siteId || 'unknown',
    retryable,
    detail: line.trim().slice(0, 500),
    rawLine: line,
  }
}

const events = []
for (const line of lines) {
  if (!line.includes('automation:') && !line.includes('cdp') && !line.includes('timeout')) continue
  const fields = extractFields(line)
  const maybeRelated = fields.sendSeq || fields.siteId || line.includes('reply settled') || line.includes('raceReply error')
  if (!maybeRelated) continue
  events.push(inferEvent(line, fields))
}

const byErrorCode = {}
const byStage = {}
for (const e of events) {
  byErrorCode[e.errorCode] = (byErrorCode[e.errorCode] || 0) + 1
  byStage[e.stage] = (byStage[e.stage] || 0) + 1
}

const maxFailures = parseInt(process.env.AUTOAI_CI_MAX_FAILURES || '0', 10)
const unknownCodeLimit = parseInt(process.env.AUTOAI_CI_MAX_UNKNOWN || '0', 10)
const unknownCount = byErrorCode.UNKNOWN || 0
const gatePassed = events.length <= maxFailures && unknownCount <= unknownCodeLimit

const snapshot = {
  extractedAt: Date.now(),
  sourceLog: inputLog,
  schemaVersion: 'v2-structured-event-stream',
  events,
  summary: {
    totalFailures: events.length,
    byErrorCode,
    byStage,
  },
  gate: {
    passed: gatePassed,
    maxFailures,
    observedFailures: events.length,
    maxUnknown: unknownCodeLimit,
    observedUnknown: unknownCount,
  },
}

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2), 'utf8')
const jsonlFile = outFile.replace(/\.json$/i, '.events.ndjson')
const ndjsonBody = events.map((e) => JSON.stringify(e)).join('\n')
fs.writeFileSync(jsonlFile, ndjsonBody ? `${ndjsonBody}\n` : '', 'utf8')
console.log(`failure snapshot written: ${outFile}`)
console.log(`failure event stream written: ${jsonlFile}`)
if (!gatePassed) {
  console.error(`failure gate failed: failures=${events.length}, unknown=${unknownCount}`)
  process.exit(2)
}

