/**
 * Gate 失败分类与 fix_prompt 生成（Hybrid 回流）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const INFRA_PATTERNS = [
  /no module named pytest/i,
  /command not found.*python/i,
  /venv missing/i,
  /codeact venv missing/i,
  /missing api key/i,
  /enoent.*python/i,
]

const SPEC_PATTERNS = [/spec_ambiguity/i, /待确认/i, /ambiguous/i]

/**
 * @param {{ errors?: string[], checks?: { id: string, pass: boolean, message: string }[] }} report
 * @returns {'implementation' | 'spec_ambiguity' | 'gate_infra'}
 */
export function classifyGateFailure(report) {
  const text = (report.errors ?? []).join('\n')
  for (const re of INFRA_PATTERNS) {
    if (re.test(text)) return 'gate_infra'
  }
  for (const re of SPEC_PATTERNS) {
    if (re.test(text)) return 'spec_ambiguity'
  }
  return 'implementation'
}

/**
 * @param {{ errors?: string[], checks?: { id: string, pass: boolean, message: string }[] }} report
 * @param {number} attempt
 */
export function buildFixPrompt(report, attempt = 1) {
  const lines = [
    `# Gate 失败修复（第 ${attempt} 轮回流）`,
    '',
    '上一轮 `gate:strict` 未通过。请**只修复实现**，不要弱化 tests/acceptance 断言。',
    '',
    '## 失败项',
    '',
  ]

  const failedChecks = (report.checks ?? []).filter((c) => !c.pass)
  if (failedChecks.length > 0) {
    for (const c of failedChecks) {
      lines.push(`- **${c.id}**: ${c.message}`)
    }
  } else {
    for (const e of report.errors ?? []) {
      lines.push(`- ${e}`)
    }
  }

  lines.push(
    '',
    '## 修复优先级',
    '',
    '1. 确保 `config.yaml` 默认路径指向**已落盘**的 fixture CSV',
    '2. 无参 `python main.py` 必须 exit 0',
    '3. 产出须有非空信号/业务数据（禁止空心绿）',
    '4. 禁止 openctp / CTP；禁止全局 mock 指标',
    '5. 跑通 `pytest -q` 且满足 `scripts/acceptance.sh`',
    '',
  )

  return lines.join('\n')
}

/**
 * @param {string} workspace
 * @param {string} content
 * @returns {string} fix_prompt.md 绝对路径
 */
export function writeFixPromptFile(workspace, content) {
  const dest = path.join(workspace, 'artifacts', 'fix_prompt.md')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, content.endsWith('\n') ? content : `${content}\n`, 'utf8')
  return dest
}
