import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Structured trace for headless runs — pinpoints failure phase without reading full engine logs.
 */
export class RunTrace {
  /** @param {string} runId */
  constructor(runId) {
    this.runId = runId
    this.startedAt = Date.now()
    /** @type {Array<Record<string, unknown>>} */
    this.events = []
    this.phase = 'init'
    this.lastGoodPhase = 'init'
  }

  /** @param {string} phase */
  setPhase(phase) {
    this.phase = phase
    this.lastGoodPhase = phase
    this.log('phase', { phase })
  }

  /**
   * @param {string} kind
   * @param {Record<string, unknown>} [detail]
   */
  log(kind, detail = {}) {
    this.events.push({
      t: Date.now() - this.startedAt,
      kind,
      phase: this.phase,
      ...detail,
    })
    if (process.env.HEADLESS_VERBOSE === '1') {
      const extra = Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : ''
      console.error(`[headless +${this.events.at(-1).t}ms ${this.phase}] ${kind}${extra}`)
    }
  }

  /**
   * @param {unknown} msg
   */
  onBackendMessage(msg) {
    if (typeof msg !== 'object' || msg === null || !('type' in msg)) {
      return
    }
    const type = String(msg.type)
    const entry = { kind: 'backend', type }
    if ('stageId' in msg) entry.stageId = String(msg.stageId)
    if ('status' in msg) entry.status = String(msg.status)
    if (type === 'workflowFailed' && 'reason' in msg) entry.reason = String(msg.reason)
    if (type === 'stageError' && 'error' in msg) entry.error = String(msg.error).slice(0, 200)
    if (type === 'workflowGenerated') {
      entry.blocked = Boolean('blocked' in msg && msg.blocked)
      if ('workflow' in msg && typeof msg.workflow === 'object' && msg.workflow !== null) {
        const wf = msg.workflow
        if ('stages' in wf && Array.isArray(wf.stages)) {
          entry.stageCount = wf.stages.length
        }
      }
    }
    this.log('backend', entry)
  }

  /**
   * @param {string} message
   * @param {Record<string, unknown>} [detail]
   */
  fail(message, detail = {}) {
    this.log('fail', { message, failurePhase: this.phase, lastGoodPhase: this.lastGoodPhase, ...detail })
  }

  summary() {
    const backendTypes = this.events
      .filter((e) => e.kind === 'backend')
      .map((e) => e.type)
    const failures = this.events.filter((e) => e.kind === 'fail')
    return {
      runId: this.runId,
      elapsedMs: Date.now() - this.startedAt,
      phase: this.phase,
      lastGoodPhase: this.lastGoodPhase,
      eventCount: this.events.length,
      backendMessageTypes: [...new Set(backendTypes)],
      failure: failures.at(-1) ?? null,
      timeline: this.events.filter((e) => e.kind === 'phase' || e.kind === 'fail' || e.kind === 'backend'),
    }
  }

  /**
   * @param {string} artifactsDir
   */
  flush(artifactsDir) {
    fs.mkdirSync(artifactsDir, { recursive: true })
    const file = path.join(artifactsDir, 'headless-feedback.trace.jsonl')
    const lines = this.events.map((e) => JSON.stringify({ runId: this.runId, ...e }))
    fs.appendFileSync(file, `${lines.join('\n')}\n`, 'utf8')
  }
}
