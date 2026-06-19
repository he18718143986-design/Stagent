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

/** Default Gate 回流次数（T4 batch run#3 在 2 次内未收敛） */
export const DEFAULT_GATE_RETRIES = 3

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
 */
function failureText(report) {
  const fromChecks = (report.checks ?? [])
    .filter((c) => !c.pass)
    .map((c) => `${c.id}: ${c.message}`)
  return [...fromChecks, ...(report.errors ?? [])].join('\n')
}

/**
 * T4 run#3 类高发失败：空 DELIVERY.md、G-signals-nonzero、pytest 红。
 * @param {string[]} lines
 * @param {{ errors?: string[], checks?: { id: string, pass: boolean, message: string }[] }} report
 */
export function appendT4TargetedHints(lines, report) {
  const blob = failureText(report)
  const hasDelivery = /DELIVERY\.md/i.test(blob)
  const hasSignals =
    /G-signals-nonzero/i.test(blob) ||
    /OPEN_LONG|OPEN_SHORT|open_long|open_short|signals\.csv/i.test(blob)
  const hasPytest = /pytest failed/i.test(blob)

  if (!hasDelivery && !hasSignals && !hasPytest) return

  lines.push('## T4 交付清单（逐项落实后再跑 Gate）', '')

  if (hasDelivery) {
    lines.push(
      '### DELIVERY.md（必填、非空）',
      '- 创建或补全 `DELIVERY.md`（**不得为空文件**）',
      '- 须说明：默认数据路径（config.yaml）、`python main.py`、`pytest -q`',
      '- 描述须与实现一致；勿写「未实现指数共振」却声称全部测试通过',
      '',
    )
  }

  if (hasSignals) {
    lines.push(
      '### 信号产出（G-signals-nonzero · 禁止空心绿）',
      '- 用**已落盘** CSV（config.yaml 默认路径）跑通：指标 → 信号 → 回测',
      '- `signals.csv` 须含至少 1 行 `OPEN_LONG` 或 `OPEN_SHORT`',
      '- `backtest_summary.json` 中 `open_long + open_short >= 1`',
      '- 禁止全局 mock / 恒空信号；指标须读真实 fixture 数据',
      '- 自检：`python main.py` → 检查 `signals.csv` 与 summary 非空',
      '',
    )
  }

  if (hasPytest) {
    lines.push(
      '### pytest',
      '- 运行 `pytest -q`，按失败栈修 **实现**（勿弱化 tests 断言）',
      '- 重点：`tests/test_e2e_signal.py`、指数共振、signals 谓词',
      '',
    )
  }

  lines.push(
    '### 回流结束前必跑',
    '```bash',
    'pytest -q',
    'python main.py',
    'test -s signals.csv && test -s DELIVERY.md',
    '```',
    '',
  )
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
    '6. 写入非空 `DELIVERY.md`（运行说明）',
    '',
  )

  appendT4TargetedHints(lines, report)

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
