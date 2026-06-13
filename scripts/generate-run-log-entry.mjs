#!/usr/bin/env node
/**
 * 缺口 2 · 沉淀自动化：从 headless 报告生成 t4-live-iteration-log.md 的 Run # 条目草稿。
 *
 * 设计原则：草稿含「机器可证事实」+「上一轮变更预测核对」（启发式，须人工确认）；
 * 根因与修复仍留人工 RCA。变更预测写入 artifacts/change-manifest.json（AHE 决策可观测性对齐）。
 *
 * Usage:
 *   node scripts/generate-run-log-entry.mjs                 # 读 artifacts/headless-feedback.json
 *   node scripts/generate-run-log-entry.mjs --batch         # 读 artifacts/headless-batch.json（附成功率）
 *   node scripts/generate-run-log-entry.mjs --report <path> # 指定报告文件
 *   node scripts/generate-run-log-entry.mjs --init-manifest # 从最近 headless 报告初始化 change-manifest.json
 *
 * 输出：stdout + artifacts/run-log-draft.md（不自动写入正式迭代日志，人工审核后粘贴）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const ARTIFACTS_DIR = path.join(REPO_ROOT, 'artifacts')
const MANIFESTS_DIR = path.join(ARTIFACTS_DIR, 'manifests')
const ITERATION_LOG = path.join(REPO_ROOT, 'docs/t4-live-iteration-log.md')
const DRAFT_PATH = path.join(ARTIFACTS_DIR, 'run-log-draft.md')
const MANIFEST_PATH = path.join(ARTIFACTS_DIR, 'change-manifest.json')
const MANIFEST_TEMPLATE_PATH = path.join(ARTIFACTS_DIR, 'change-manifest.template.json')

function parseArgs(argv) {
  const opts = {
    report: path.join(ARTIFACTS_DIR, 'headless-feedback.json'),
    batch: false,
    initManifest: false,
    archiveManifest: true,
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--report') opts.report = path.resolve(argv[++i])
    else if (argv[i] === '--batch') {
      opts.batch = true
      opts.report = path.join(ARTIFACTS_DIR, 'headless-batch.json')
    } else if (argv[i] === '--init-manifest') opts.initManifest = true
    else if (argv[i] === '--no-archive-manifest') opts.archiveManifest = false
  }
  return opts
}

/** 下一个 Run 编号 = 迭代日志现存最大「运行 #N」 + 1。 */
function nextRunNumber() {
  if (!fs.existsSync(ITERATION_LOG)) return 1
  const text = fs.readFileSync(ITERATION_LOG, 'utf8')
  let max = 0
  for (const m of text.matchAll(/运行 #(\d+)/g)) {
    max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

function fmtSeconds(ms) {
  return ms != null ? `${Math.round(ms / 100) / 10}s` : '?'
}

function fmtUsage(u) {
  if (!u) return '未计量'
  const est = u.estimatedCalls > 0 ? `（${u.estimatedCalls} 次为估算）` : ''
  const cost = u.estimatedCost !== undefined ? `；费用≈${u.estimatedCost}` : ''
  return `${u.calls} 次调用，in ${u.promptTokens} / out ${u.completionTokens} tok${est}${cost}`
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

/** 提取工作区 .wf-failures.jsonl 的失败摘要（按 stageId × errorType 聚合）。 */
function failureDigest(workspace) {
  if (!workspace) return []
  const instancesDir = path.join(workspace, '.stagent', 'instances')
  if (!fs.existsSync(instancesDir)) return []
  const lines = []
  for (const key of fs.readdirSync(instancesDir)) {
    const f = path.join(instancesDir, key, '.wf-failures.jsonl')
    if (!fs.existsSync(f)) continue
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        lines.push(JSON.parse(line))
      } catch {
        /* 跳过坏行 */
      }
    }
  }
  const agg = new Map()
  for (const r of lines) {
    const k = `${r.stageId} · ${r.errorType}`
    const cur = agg.get(k) ?? { count: 0, sample: r.errorSummary }
    cur.count += 1
    agg.set(k, cur)
  }
  return [...agg.entries()].map(([k, v]) => `${k} ×${v.count} — ${v.sample}`)
}

function scenarioHaystack(scenario, digest) {
  return [
    scenario.failurePhase ?? '',
    scenario.lastGoodPhase ?? '',
    scenario.error ?? '',
    scenario.outcome ?? '',
    ...digest,
  ]
    .join(' ')
    .toLowerCase()
}

const SLICE_KEYWORDS = ['indicators', 'signals', 'risk', 'broker', 'system', 'main']

function tokenizePrediction(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9_\u4e00-\u9fff]+/)
    .filter((t) => t.length > 2)
}

/** 启发式评估单条「预测修复」；须人工确认。 */
function assessFixPrediction(prediction, scenario, digest) {
  const pass = scenario.status === 'pass'
  if (pass) {
    return { verdict: '待确认', note: '本轮 PASS；须对照 strict 口径与预测条目逐项确认' }
  }

  const hay = scenarioHaystack(scenario, digest)
  const p = prediction.toLowerCase()
  const failurePhase = (scenario.failurePhase ?? '').toLowerCase()

  for (const slice of SLICE_KEYWORDS) {
    if (!p.includes(slice)) continue
    const stillOnSlice = failurePhase.includes(slice) || hay.includes(`${slice}`)
    const wantsGreen = /绿|pass|exit\s*0|通过|strict/.test(p)
    if (wantsGreen) {
      return stillOnSlice
        ? { verdict: '未证', note: `失败仍落在 ${slice} 相关阶段` }
        : { verdict: '建议命中', note: `失败点未在 ${slice}，可能已越过该切片` }
    }
    if (stillOnSlice) return { verdict: '未证', note: `失败信息仍涉及 ${slice}` }
  }

  const tokens = tokenizePrediction(prediction)
  const matched = tokens.filter((t) => hay.includes(t))
  if (matched.length) {
    return { verdict: '未证', note: `失败上下文仍含关键词：${matched.slice(0, 5).join(', ')}` }
  }
  return { verdict: '待确认', note: '无法自动匹配，请人工对照失败摘要' }
}

/** 启发式评估单条「预测回归」。 */
function assessRegressionPrediction(prediction, scenario, digest) {
  const pass = scenario.status === 'pass'
  if (pass) return { verdict: '未出现', note: '本轮 PASS' }

  const hay = scenarioHaystack(scenario, digest)
  const tokens = tokenizePrediction(prediction)
  const matched = tokens.filter((t) => hay.includes(t))
  if (matched.length) {
    return { verdict: '出现', note: `失败处匹配：${matched.slice(0, 5).join(', ')}` }
  }
  return { verdict: '未出现', note: '失败点与预测回归关键词无交集' }
}

function reconcileManifestSection(manifest, scenario, digest) {
  const out = []
  out.push('### 上一轮变更预测核对（自动 · 须人工确认）')
  out.push('')
  if (!manifest) {
    out.push(
      '> 无 `artifacts/change-manifest.json`。若本轮前有 harness 改动，请先 `npm run log:manifest` 填写预测再跑 Live。',
    )
    out.push('')
    return out.join('\n')
  }

  const pass = scenario.status === 'pass'
  out.push('| 字段 | 内容 |')
  out.push('|------|------|')
  if (manifest.targetRun != null) out.push(`| 目标 Run | #${manifest.targetRun} |`)
  if (manifest.createdAt) out.push(`| manifest 日期 | ${manifest.createdAt} |`)
  out.push(`| 关联证据 | ${manifest.evidence ?? '—'} |`)
  out.push(`| 推断根因 | ${manifest.rootCause ?? '—'} |`)
  out.push(`| 本轮判定 | ${pass ? '**PASS**' : `**FAIL** @ ${scenario.failurePhase ?? '?'}`} |`)
  out.push('')

  if (Array.isArray(manifest.changes) && manifest.changes.length) {
    out.push('#### 登记改动')
    out.push('')
    for (const ch of manifest.changes) {
      const files = Array.isArray(ch.files) ? ch.files.join(', ') : ch.files ?? '—'
      out.push(`- **${ch.id ?? 'chg'}**：${ch.what ?? '—'}（${files}）`)
    }
    out.push('')
  }

  out.push('#### 预测修复')
  out.push('')
  const fixes = manifest.predictedFixes ?? []
  if (!fixes.length) {
    out.push('- （manifest 未填写 predictedFixes）')
  } else {
    for (const f of fixes) {
      const { verdict, note } = assessFixPrediction(f, scenario, digest)
      out.push(`- [${verdict}] ${f} — ${note}`)
    }
  }
  out.push('')

  out.push('#### 预测回归')
  out.push('')
  const regs = manifest.predictedRegressions ?? []
  if (!regs.length) {
    out.push('- （manifest 未填写 predictedRegressions）')
  } else {
    for (const r of regs) {
      const { verdict, note } = assessRegressionPrediction(r, scenario, digest)
      out.push(`- [${verdict}] ${r} — ${note}`)
    }
  }
  out.push('')
  out.push('> 核对为启发式建议，非最终裁决；无效改动按文件粒度回滚（AHE 决策可观测性）。')
  out.push('')
  return out.join('\n')
}

function nextManifestTemplateSection(runNo) {
  const out = []
  out.push('### 下一轮变更预测（harness 改动**前**填写）')
  out.push('')
  out.push(`1. 复制模板：\`cp artifacts/change-manifest.template.json artifacts/change-manifest.json\``)
  out.push(`2. 或运行：\`npm run log:manifest\`（从本轮失败摘要预填 evidence）`)
  out.push(`3. 填写 \`predictedFixes\` / \`predictedRegressions\`，设 \`targetRun\` 为 ${runNo + 1}`)
  out.push(`4. 合入 harness 改动后执行下一轮 Live，再 \`npm run log:draft\` 生成本节核对`)
  out.push('')
  out.push('| 字段 | 说明 |')
  out.push('|------|------|')
  out.push('| evidence | 本轮失败证据（Run # / stage / 摘要） |')
  out.push('| rootCause | 推断根因（机制类，非「模型不行」） |')
  out.push('| changes[] | 登记改动：id / files / what / failurePattern |')
  out.push('| predictedFixes | 预测下一轮应修复的现象（可多条） |')
  out.push('| predictedRegressions | 预测可能回归的风险（可多条） |')
  out.push('')
  return out.join('\n')
}

function archiveManifest(manifest, runNo) {
  if (!manifest) return
  fs.mkdirSync(MANIFESTS_DIR, { recursive: true })
  const archived = {
    ...manifest,
    archivedAt: new Date().toISOString(),
    reconciledRun: runNo,
  }
  const dest = path.join(MANIFESTS_DIR, `run-${runNo}-manifest.json`)
  fs.writeFileSync(dest, `${JSON.stringify(archived, null, 2)}\n`, 'utf8')
  return dest
}

function initManifestFromReport(reportPath) {
  const report = readJsonIfExists(reportPath)
  if (!report) {
    console.error(`报告不存在或无法解析：${reportPath}`)
    process.exit(1)
  }

  const template = readJsonIfExists(MANIFEST_TEMPLATE_PATH) ?? {
    evidence: '',
    rootCause: '',
    changes: [],
    predictedFixes: [],
    predictedRegressions: [],
  }

  const runNo = nextRunNumber()
  const date = (report.timestamp ?? new Date().toISOString()).slice(0, 10)
  const fail = report.scenarios?.find((s) => s.status === 'fail') ?? report.scenarios?.[0]
  const digest = fail ? failureDigest(fail.workspace) : []

  const evidenceParts = []
  if (fail) {
    evidenceParts.push(`Run #${runNo - 1} 草稿基准`)
    if (fail.failurePhase) evidenceParts.push(`失败 @ ${fail.failurePhase}`)
    if (fail.error) evidenceParts.push(String(fail.error).slice(0, 200))
    if (digest[0]) evidenceParts.push(digest[0])
  }

  const manifest = {
    $schema: template.$schema ?? 'stagent/change-manifest/v1',
    targetRun: runNo,
    createdAt: date,
    evidence: evidenceParts.join('；') || template.evidence,
    rootCause: template.rootCause ?? '',
    changes: template.changes ?? [],
    predictedFixes: template.predictedFixes ?? [],
    predictedRegressions: template.predictedRegressions ?? [],
  }

  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true })
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.error(`已写入 ${MANIFEST_PATH}（targetRun=#${runNo}）`)
  console.error('请编辑 predictedFixes / predictedRegressions / changes 后合入 harness 改动，再跑 Live。')
  console.log(JSON.stringify(manifest, null, 2))
}

function batchManifestReconcile(manifest, batch) {
  const out = []
  out.push('### 批量跑批 · 变更预测核对（自动 · 须人工确认）')
  out.push('')
  if (!manifest) {
    out.push('> 无 `artifacts/change-manifest.json`。')
    out.push('')
    return out.join('\n')
  }

  const t4 = batch.scenarios?.find((s) => s.id === 't4') ?? batch.scenarios?.[0]
  out.push('| 字段 | 内容 |')
  out.push('|------|------|')
  out.push(`| 关联证据 | ${manifest.evidence ?? '—'} |`)
  out.push(`| 批量 verdict | **${batch.verdict?.pass ? 'PASS' : 'FAIL'}** — ${batch.verdict?.rule ?? ''} |`)
  if (t4) {
    out.push(`| strict 成功率 | ${t4.strictPassed}/${t4.attempts}（阈值 ≥${batch.threshold}） |`)
  }
  out.push('')

  const syntheticScenario = {
    status: batch.verdict?.pass ? 'pass' : 'fail',
    failurePhase: t4 && !batch.verdict?.pass ? `batch strict ${t4.strictPassed}/${t4.attempts}` : '',
    error: batch.verdict?.rule ?? '',
  }

  out.push('#### 预测修复')
  out.push('')
  for (const f of manifest.predictedFixes ?? ['（未填写）']) {
    if (f === '（未填写）') {
      out.push(`- ${f}`)
      continue
    }
    const pass = batch.verdict?.pass && t4?.meetsThreshold
    const note = pass
      ? '批量达阈值；须人工确认 strict 口径'
      : `未达阈值（strict ${t4?.strictPassed ?? '?'}/${t4?.attempts ?? '?'})`
    out.push(`- [${pass ? '建议命中' : '未证'}] ${f} — ${note}`)
  }
  out.push('')

  out.push('#### 预测回归')
  out.push('')
  for (const r of manifest.predictedRegressions ?? ['（未填写）']) {
    if (r === '（未填写）') {
      out.push(`- ${r}`)
      continue
    }
    const appeared = !batch.verdict?.pass
    out.push(`- [${appeared ? '待确认' : '未出现'}] ${r} — 批量${appeared ? '未达阈值，需对照逐 run' : '达阈值'}`)
  }
  out.push('')
  return out.join('\n')
}

function scenarioEntry(s, runNo, date, commit, manifest, opts) {
  const pass = s.status === 'pass'
  const verdict = pass
    ? `**PASS** \`${s.outcome ?? 'workflowCompleted'}\`${s.strictMvp ? '（含 strict MVP 验收）' : ''}`
    : `**FAIL** ${s.failurePhase ? `@ ${s.failurePhase}` : ''}`
  const digest = failureDigest(s.workspace)
  const out = []
  out.push(`## 运行 #${runNo} — ${date}（<一句话主题，人工填写>）`)
  out.push('')
  out.push('| 字段 | 值 |')
  out.push('|------|-----|')
  out.push(`| instance | \`${s.instanceKey ?? '未捕获'}\` |`)
  out.push(`| 耗时 | ${fmtSeconds(s.elapsedMs)} |`)
  out.push(`| headless 判定 | ${verdict} |`)
  if (s.stageCount) out.push(`| 阶段数 | ${s.stageCount} |`)
  out.push(`| 工作区 | \`${s.workspace ?? '?'}\` |`)
  out.push(`| commit | \`${commit}\` |`)
  out.push(`| LLM 用量 | ${fmtUsage(s.llmUsage)} |`)
  out.push('')
  out.push('### 结果')
  out.push('')
  if (pass) {
    if (s.artifacts?.length) out.push(`- 产物：${s.artifacts.join('、')}`)
    if (s.strictMvp?.testFiles?.length) out.push(`- strict 验收测试文件：${s.strictMvp.testFiles.join('、')}`)
    if (s.strictMvp?.warnings?.length) out.push(`- strict 警告：${s.strictMvp.warnings.join('；')}`)
    if (!s.artifacts?.length && !s.strictMvp) out.push('- <人工补充>')
  } else {
    out.push(`- 失败：\`${String(s.error ?? '').slice(0, 300)}\``)
    if (s.failurePhase) out.push(`- 失败阶段：${s.failurePhase}（最后正常：${s.lastGoodPhase ?? '?'}）`)
    if (digest.length) {
      out.push('- `.wf-failures.jsonl` 摘要：')
      for (const d of digest.slice(0, 8)) out.push(`  - ${d}`)
    }
  }
  out.push('')
  out.push(reconcileManifestSection(manifest, s, digest))
  out.push('### 根因（人工 RCA 后填写）')
  out.push('')
  out.push('- <待填>')
  out.push('')
  out.push('### 修复（人工填写；行为变更须附单测 + 附录 B 行）')
  out.push('')
  out.push('- <待填>')
  out.push('')
  out.push(nextManifestTemplateSection(runNo))
  if (opts.archiveManifest && manifest) {
    const archived = archiveManifest(manifest, runNo)
    if (archived) out.push(`> 已归档 manifest → \`${path.relative(REPO_ROOT, archived)}\``)
    out.push('')
  }
  return out.join('\n')
}

function batchSection(batch, manifest, opts) {
  const out = []
  out.push(batchManifestReconcile(manifest, batch))
  out.push(`### 批量成功率（--repeat ${batch.repeat}，阈值 ≥${batch.threshold}）`)
  out.push('')
  out.push('| scenario | pass | strict | 判定 |')
  out.push('|----------|------|--------|------|')
  for (const s of batch.scenarios) {
    out.push(
      `| ${s.id} | ${s.passed}/${s.attempts} | ${s.strictPassed}/${s.attempts} | ${s.meetsThreshold ? '✓' : '✗'} |`,
    )
  }
  out.push('')
  out.push(`整体 verdict：**${batch.verdict.pass ? 'PASS' : 'FAIL'}** — ${batch.verdict.rule}`)
  out.push('')
  out.push(nextManifestTemplateSection(nextRunNumber()))
  if (opts.archiveManifest && manifest) {
    const runNo = nextRunNumber()
    const archived = archiveManifest(manifest, runNo)
    if (archived) out.push(`> 已归档 manifest → \`${path.relative(REPO_ROOT, archived)}\``)
    out.push('')
  }
  return out.join('\n')
}

function main() {
  const opts = parseArgs(process.argv.slice(2))

  if (opts.initManifest) {
    initManifestFromReport(opts.report)
    return
  }

  if (!fs.existsSync(opts.report)) {
    console.error(`报告不存在：${opts.report}（先跑 npm run feedback:live:t4 或 --repeat 批量）`)
    process.exit(1)
  }
  const report = JSON.parse(fs.readFileSync(opts.report, 'utf8'))
  const manifest = readJsonIfExists(MANIFEST_PATH)
  const date = (report.timestamp ?? new Date().toISOString()).slice(0, 10)
  const commit = report.commit ?? 'unknown'
  let runNo = nextRunNumber()

  const blocks = []
  if (opts.batch) {
    blocks.push(batchSection(report, manifest, opts))
    blocks.push('> 逐 run 详情：`node scripts/generate-run-log-entry.mjs --report artifacts/batch/run-<i>.json`')
  } else {
    const interesting = report.scenarios.filter(
      (s) => s.status === 'fail' || s.strictMvp !== undefined || /t4|t5/.test(s.id ?? ''),
    )
    const targets = interesting.length > 0 ? interesting : report.scenarios
    for (const s of targets) {
      blocks.push(scenarioEntry(s, runNo, date, commit, manifest, opts))
      runNo += 1
    }
  }

  const draft = blocks.join('\n---\n\n')
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true })
  fs.writeFileSync(DRAFT_PATH, draft, 'utf8')
  console.log(draft)
  console.error('')
  console.error(`草稿已写入 ${DRAFT_PATH}`)
  console.error('流程：log:manifest 填预测 → 改 harness → Live → log:draft 核对 → 人工审核后插入迭代日志。')
}

main()
