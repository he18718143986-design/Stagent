import * as fs from 'node:fs'
import * as path from 'node:path'

const DEMO_ENTRY_REL = 'demo/run_demo.py'
const DEMO_SUMMARY_REL = 'demo/summary.json'
const DEMO_SUMMARY_SCHEMA_REL = 'demo/summary.schema.json'
const QUICKSTART_REL = 'QUICKSTART.md'

function readFileIfExists(abs) {
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return null
    }
    return fs.readFileSync(abs, 'utf8')
  } catch {
    return null
  }
}

function resolveRequiredKeys(ws, options = {}) {
  if (options.requiredSummaryKeys?.length) {
    return options.requiredSummaryKeys
  }
  const schemaRel = options.summarySchemaRelPath ?? DEMO_SUMMARY_SCHEMA_REL
  const schemaText = readFileIfExists(path.join(ws, schemaRel))
  if (!schemaText) {
    return []
  }
  try {
    const parsed = JSON.parse(schemaText)
    if (Array.isArray(parsed.requiredKeys)) {
      return parsed.requiredKeys.filter((k) => typeof k === 'string' && k.length > 0)
    }
  } catch {
    /* ignore */
  }
  return []
}

function collectArtifacts(ws) {
  const artifacts = []
  for (const rel of [DEMO_ENTRY_REL, DEMO_SUMMARY_REL, DEMO_SUMMARY_SCHEMA_REL, QUICKSTART_REL]) {
    const abs = path.join(ws, rel)
    if (fs.existsSync(abs) && fs.statSync(abs).isFile() && fs.statSync(abs).size > 0) {
      artifacts.push(rel)
    }
  }
  return artifacts
}

/**
 * 可体验交付独立验收（不污染 strict MVP 口径）。
 * @param {string} ws 工作区根
 * @param {{ exitCode?: number }} opts
 * @returns {{ pass: boolean, artifacts: string[], issues: string[] }}
 */
export function checkDemoDelivery(ws, opts = {}) {
  const issues = []
  const artifacts = collectArtifacts(ws)

  if (opts.exitCode != null && opts.exitCode !== 0) {
    issues.push(`demo-run-failed: exit ${opts.exitCode}`)
    return { pass: false, artifacts, issues }
  }

  const entryAbs = path.join(ws, DEMO_ENTRY_REL)
  if (!fs.existsSync(entryAbs) || fs.statSync(entryAbs).size === 0) {
    issues.push(`demo-entry-missing: 缺少 ${DEMO_ENTRY_REL}`)
  }

  const summaryRel = opts.summaryRelPath ?? DEMO_SUMMARY_REL
  const summaryText = readFileIfExists(path.join(ws, summaryRel))
  if (summaryText === null) {
    issues.push(`demo-summary-missing: 缺少 ${summaryRel}`)
  } else if (!summaryText.trim()) {
    issues.push(`demo-summary-empty: ${summaryRel} 为空`)
  } else {
    try {
      const parsed = JSON.parse(summaryText)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        issues.push(`demo-summary-invalid-json: ${summaryRel} 须为 JSON 对象`)
      } else {
        for (const key of resolveRequiredKeys(ws, opts)) {
          const val = parsed[key]
          if (val === undefined || val === null || val === '') {
            issues.push(`demo-summary-schema: ${summaryRel} 缺必需键 "${key}"`)
          }
        }
      }
    } catch {
      issues.push(`demo-summary-invalid-json: ${summaryRel} 不是合法 JSON`)
    }
  }

  const quickstartRel = opts.quickstartRelPath ?? QUICKSTART_REL
  if (opts.requireQuickstart !== false) {
    const quickstart = readFileIfExists(path.join(ws, quickstartRel))
    if (quickstart === null || !quickstart.trim()) {
      issues.push(`demo-quickstart-missing: 缺少 ${quickstartRel}`)
    }
  }

  return {
    pass: issues.length === 0,
    artifacts,
    issues,
  }
}
