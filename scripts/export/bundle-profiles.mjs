import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { LIVE_TASK_TIERS } from '../headless/lib/live-tasks.mjs'
import { MVP_MODULE_DIRS, TRACEABILITY_RULES } from '../headless/lib/mvp-acceptance.mjs'

const EXPORT_DIR = path.dirname(fileURLToPath(import.meta.url))
export const TEMPLATES_DIR = path.join(EXPORT_DIR, 'templates')
export const REPO_ROOT = path.resolve(EXPORT_DIR, '../..')

/** @param {string|number|undefined} raw */
export function parseTierArg(raw) {
  if (raw == null || raw === '') throw new Error('缺少 --tier（t4|t5|t6|t7 或 4–7）')
  const s = String(raw).toLowerCase().replace(/^t/, '')
  const tier = Number(s)
  if (!Number.isFinite(tier) || !LIVE_TASK_TIERS[tier]) {
    throw new Error(`未知 --tier：${raw}（支持 t4|t5|t6|t7 或 4–7）`)
  }
  return tier
}

/** @typedef {{ id: string, src: string, dest: string, required?: boolean }} SpecRef */

/** @type {Record<number, { templateId: string, specRefs: SpecRef[], seedWorkspace: string[] }>} */
const BUNDLE_PROFILES = {
  4: {
    templateId: 't4',
    specRefs: [
      {
        id: 'backtest-spec',
        src: 'docs/comercial/期货策略-可验收回测规格.md',
        dest: '期货策略-可验收回测规格.md',
        required: true,
      },
      {
        id: 'requirements-nanhua',
        src: '../T4/需求分析-南华期货自动下单.md',
        dest: '需求分析-南华期货自动下单.md',
        required: false,
      },
    ],
    seedWorkspace: [
      'tests/test_e2e_signal.py',
      'scripts/acceptance.sh',
      'fixtures/README.md',
    ],
  },
  5: {
    templateId: 't4',
    specRefs: [
      {
        id: 'backtest-spec',
        src: 'docs/comercial/期货策略-可验收回测规格.md',
        dest: '期货策略-可验收回测规格.md',
        required: true,
      },
    ],
    seedWorkspace: [
      'tests/test_e2e_signal.py',
      'scripts/acceptance.sh',
      'fixtures/README.md',
    ],
  },
  6: {
    templateId: 't6',
    specRefs: [],
    seedWorkspace: ['scripts/acceptance.sh'],
  },
  7: {
    templateId: 't7',
    specRefs: [],
    seedWorkspace: ['scripts/acceptance.sh'],
  },
}

/**
 * @param {number} tier
 * @returns {{ tier: number, spec: object, profile: object, templateId: string }}
 */
export function resolveBundleProfile(tier) {
  const spec = LIVE_TASK_TIERS[tier]
  if (!spec) throw new Error(`未知 tier ${tier}`)
  const profile = BUNDLE_PROFILES[tier] ?? BUNDLE_PROFILES[4]
  return { tier, spec, profile, templateId: profile.templateId }
}

/**
 * 构建 task.json v1 载荷。
 * @param {{ tier: number, spec: object, workspaceRel?: string }} input
 */
export function serializeTraceabilityRules(rules) {
  if (!rules) return undefined
  return rules.map((r) => {
    if (typeof r.check === 'function') {
      return { id: r.id, hint: r.hint, dirs: r.dirs, requireDirPy: r.requireDirPy }
    }
    const out = {
      id: r.id,
      dirs: r.dirs,
      hint: r.hint,
      requireDirPy: r.requireDirPy,
      requireDirTs: r.requireDirTs,
    }
    if (r.pattern instanceof RegExp) {
      out.pattern = { source: r.pattern.source, flags: r.pattern.flags }
    }
    return out
  })
}

export function buildTaskJson({ tier, spec, workspaceRel = '.' }) {
  const mvp = spec.mvp ?? {}

  /** @type {Record<string, unknown>} */
  const mvpBlock = {}
  if (tier === 4 || tier === 5) {
    mvpBlock.moduleDirs = MVP_MODULE_DIRS
    mvpBlock.traceability = serializeTraceabilityRules(TRACEABILITY_RULES)
    mvpBlock.smoke = { run: 'main', minSignals: 1 }
  } else if (mvp.moduleDirs) {
    mvpBlock.moduleDirs = mvp.moduleDirs
    if (mvp.traceability) mvpBlock.traceability = serializeTraceabilityRules(mvp.traceability)
    if (mvp.fixtures) mvpBlock.fixtures = mvp.fixtures
    if (mvp.smoke) mvpBlock.smoke = mvp.smoke
    if (mvp.architectureScan) mvpBlock.architectureScan = mvp.architectureScan
  }

  return {
    version: 1,
    tier,
    taskId: spec.id,
    taskType: spec.taskType ?? 'software',
    language: 'py',
    workspace: workspaceRel,
    specRefs: [],
    mvp: mvpBlock,
    codeact: {
      maxSteps: tier === 4 || tier === 5 ? 80 : 60,
      timeoutMs: spec.timeoutMs ?? 1_200_000,
      enableBrowser: false,
      forbiddenPatterns: ['openctp', 'np.random'],
    },
    llm: {
      model: '${LLM_MODEL}',
      baseUrl: '${LLM_BASE_URL}',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
    },
  }
}

/**
 * @param {number} tier
 * @param {string} specTitle
 */
export function buildOpenhandsPrompt(tier, specTitle) {
  const lines = [
    `# ${specTitle}`,
    '',
    '你是 Stagent Hybrid 流水线的 **CodeAct 实现者**。请在工作区完成可交付 MVP。',
    '',
    '## 硬性约束（违反即 Gate FAIL）',
    '',
    '- **不得修改** `scripts/acceptance.sh`、`tests/test_e2e_signal.py`（若存在）的**断言语义**',
    '- **不得**自判交付完成；唯一裁判是 `npm run gate:strict`',
    '- **禁止** openctp / CTP / 任何实盘券商 SDK',
    '- **禁止**用 `np.random` 或全局 mock 绕过指标/数据管道',
    '- fixture CSV **必须落盘**到 `fixtures/` 或 `data/`，并在 `config.yaml` 默认路径引用',
    '- 交付须含：`config.yaml`、模块目录、`main.py`、`tests/`、`DELIVERY.md`、`requirements.txt`',
    '',
  ]

  if (tier === 4 || tier === 5) {
    lines.push(
      '## T4 模块契约',
      '',
      '- `indicators/` — K线/BOLL/VOL/MACD/CCI 指标',
      '- `signals/` — 多空入场谓词（含指数共振）',
      '- `risk/` — 止损与对冲规则',
      '- `broker/` — `SimBroker` + `BrokerAdapter` 抽象，不接实盘',
      '',
      '## 数据与产出',
      '',
      '- 输入：`data/bars_3m.csv`、`data/bars_1m.csv`、`data/index_sh.csv`、`data/index_sz.csv`',
      '- 输出：`signals.csv`、`backtest_summary.json`（`open_long+open_short >= 1`）',
      '- 无参 `python main.py` 必须 exit 0',
      '- **`DELIVERY.md` 非空**（运行说明，Gate 检查）',
      '',
      '## 完成前自检',
      '',
      '```bash',
      'pytest -q && python main.py',
      '# signals.csv 须含 OPEN_LONG/OPEN_SHORT；DELIVERY.md 非空',
      '```',
      '',
    )
  } else if (tier === 6) {
    lines.push(
      '## T6 模块契约',
      '',
      '- `models/`、`store/`、`statemachine/`、`pipeline/` + `main.py`',
      '- 确定性 CRUD + 状态机 + CSV 管道；`summary.json` 不得全 0',
      '',
    )
  } else if (tier === 7) {
    lines.push(
      '## T7 模块契约',
      '',
      '- `models/`、`store/`、`progress/`、`finance/`、`alerts/`、`report/` + `main.py`',
      '- 工程进度加权、财务匹配、预警、月度报表；`output.json` 不得全 0',
      '',
    )
  }

  lines.push(
    '## 验收',
    '',
    '实现完成后由 Stagent 执行：',
    '',
    '```bash',
    'npm run gate:strict -- --workspace . --bundle .stagent-bundle',
    '```',
    '',
  )

  return lines.join('\n')
}

export function resolveSpecRefPath(ref) {
  const src = ref.src
  if (path.isAbsolute(src)) return src
  if (src.startsWith('../')) return path.resolve(REPO_ROOT, src)
  return path.join(REPO_ROOT, src)
}
