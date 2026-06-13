import * as fs from 'node:fs'
import * as path from 'node:path'

/** Charter 相对工作区路径（与引擎默认一致）。 */
export const CHARTER_REL_PATH = 'docs/agents/charter.md'

/**
 * Live API task tiers — simple → complex.
 * T4 = 用户真实项目工作区（默认 repo 根目录 ../T4 或 --workspace 指定）
 * T5 = T4 + charter suggest 全链加压
 */
const T4_USER_INPUT = `在南华期货场景下开发「期货自动下单」软件（Python）。

工作区已有需求文档 \`需求分析-南华期货自动下单.md\`，请以其为真源实现首版 MVP。

核心能力：
1. 指标：K线均线 5+6+7+8+9+11+20；BOLL 20+2；VOL 3+100；MACD 14+53+60；CCI 89
2. 空信号（3分钟）：前五线并拢<2点后穿20日线；布林带横盘不做；VOL白线升+绿柱倍量；MACD近零轴绿柱加长；CCI二次下穿0轴；1分钟同向下穿20日线；上证+深证均在20日线下
3. 多信号（3分钟）：前五线并拢<2点后穿20日线；横盘不做；VOL白线升+红柱倍量；MACD零轴上近零轴红柱加长；CCI半小时内二次上穿0轴；1分钟上穿20日线且1/3分钟带白点；上证+深证均在20日线上
4. 止损15点：区分昨日对冲单与当日开单的多空对冲规则（详见需求文档第四节）
5. 交付：config.yaml、indicators/、signals/、risk/、broker/（SimBroker+BrokerAdapter抽象）、main/cli、pytest、DELIVERY.md
6. 首版不接实盘，仅模拟券商适配器；指数可用 mock/CSV

taskType 按 software 组织：多切片、完整交付；先架构决策，再 indicators/ signals/ risk/ broker/ 垂直切片实现与验证。`

export const LIVE_TASK_TIERS = {
  1: {
    id: 'live-t1-minimal',
    label: 'T1 最小：单文件 Python 函数',
    taskType: 'prototype',
    userInput:
      '用 Python 实现 calc.py：提供 add(a, b) 返回两数之和。不要测试框架、不要多余文件，单文件即可。',
    polish: false,
    timeoutMs: 300_000,
    pass: {
      terminal: 'workflowCompleted',
      minStages: 2,
      maxStages: 10,
    },
  },
  2: {
    id: 'live-t2-prototype',
    label: 'T2 标准：多文件 prototype 闭环',
    taskType: 'prototype',
    userInput:
      '读取本地 input.csv，统计 status=active 的行数与金额合计，写出 summary.json。需要 reader.py + main.py，Python 实现。',
    polish: true,
    timeoutMs: 300_000,
    pass: {
      terminal: 'workflowCompleted',
      minStages: 3,
      maxStages: 16,
    },
  },
  3: {
    id: 'live-t3-software-tdd',
    label: 'T3 复杂：software + 测试验证',
    taskType: 'software',
    userInput:
      '在空目录实现 calculator 模块：add/sub 两个函数，编写 test_calculator.py 用 pytest 验证。保持最小可运行结构。',
    polish: false,
    timeoutMs: 420_000,
    pass: {
      terminal: ['workflowCompleted', 'workflowFailed'],
      acceptRunnerFailure: true,
      minStages: 4,
      maxStages: 24,
    },
  },
  4: {
    id: 'live-t4-nanhua-futures',
    label: 'T4 真实：南华期货自动下单',
    taskType: 'software',
    userInput: T4_USER_INPUT,
    polish: true,
    timeoutMs: 2_400_000,
    generationAttempts: 2,
    pass: {
      terminal: 'workflowCompleted',
      strict: true,
      minStages: 6,
      // skeletonCompiler + disk-bootstrap：~40–45 stages（PRD §16.2 #4）
      maxStages: 55,
    },
  },
  5: {
    id: 'live-t5-t4-charter-suggest',
    label: 'T5 加压：T4 + charter suggest 全链',
    taskType: 'software',
    userInput: T4_USER_INPUT,
    polish: true,
    timeoutMs: 2_400_000,
    generationAttempts: 2,
    charter: {
      enabled: true,
      autoAnswerMode: 'suggest',
      path: CHARTER_REL_PATH,
      grillAdaptiveMode: false,
    },
    pass: {
      terminal: 'workflowCompleted',
      strict: true,
      minStages: 6,
      maxStages: 55,
      charterFileRequired: true,
      charterActivityRequired: true,
    },
  },
}

/** 默认 T4 工作区：autoAI 上级目录的 T4/ */
export function defaultT4Workspace(repoRoot) {
  return `${repoRoot}/../T4`
}

/** 复制南华期货 Charter 到工作区 `docs/agents/charter.md`。 */
export function copyCharterToWorkspace(workspace, repoRoot) {
  const ws = path.resolve(workspace)
  const charterDir = path.join(ws, path.dirname(CHARTER_REL_PATH))
  fs.mkdirSync(charterDir, { recursive: true })
  const dst = path.join(ws, CHARTER_REL_PATH)
  const candidates = [
    path.join(repoRoot, '../task/docs/agents/charter.md'),
    path.join(repoRoot, '../T4/docs/agents/charter.md'),
    path.join(repoRoot, '../.stagent/charter/calibration/charter-seed.md'),
  ]
  for (const src of candidates) {
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst)
      return dst
    }
  }
  throw new Error(
    `charter source not found — expected one of: ${candidates.join(', ')}`,
  )
}

/**
 * T4 迭代专用工作区：复制需求真源 + Charter。
 * @param {string} repoRoot autoAI 根目录
 * @param {{ resume?: boolean }} [opts]
 */
export function prepareT4IterWorkspace(repoRoot, opts = {}) {
  const t4Root = path.resolve(repoRoot, '../T4')
  const iterDir = path.join(t4Root, '.headless-iter')
  if (!opts.resume && fs.existsSync(iterDir)) {
    fs.rmSync(iterDir, { recursive: true, force: true })
  }
  fs.mkdirSync(iterDir, { recursive: true })
  const reqName = '需求分析-南华期货自动下单.md'
  const reqSrc = path.join(t4Root, reqName)
  const reqDst = path.join(iterDir, reqName)
  if (fs.existsSync(reqSrc)) {
    fs.copyFileSync(reqSrc, reqDst)
  }
  copyCharterToWorkspace(iterDir, repoRoot)
  return iterDir
}

/**
 * --resume：从工作区找 status=running 的 instance，跳过 generate 直接续跑。
 * @param {string} workspaceRoot
 * @returns {{ instanceKey: string, workflow: object } | null}
 */
export function findResumableInstance(workspaceRoot) {
  const instRoot = path.join(workspaceRoot, '.stagent', 'instances')
  if (!fs.existsSync(instRoot)) {
    return null
  }
  for (const key of fs.readdirSync(instRoot)) {
    const statePath = path.join(instRoot, key, '.wf-state.json')
    if (!fs.existsSync(statePath)) {
      continue
    }
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      if (state.status === 'running' && state.definition?.stages?.length) {
        return { instanceKey: key, workflow: state.definition }
      }
    } catch {
      /* skip corrupt state */
    }
  }
  return null
}

/**
 * @param {string | number} tier
 */
export function resolveLiveTiers(tier) {
  if (tier === 'all') {
    return [1, 2, 3, 4, 5]
  }
  const n = Number(tier)
  if (![1, 2, 3, 4, 5].includes(n)) {
    throw new Error(`--live-tier must be 1, 2, 3, 4, 5, or all (got: ${tier})`)
  }
  return [n]
}

/** T4/T5 档位使用迭代工作区。 */
export function isT4FamilyTier(tierNum) {
  return tierNum === 4 || tierNum === 5
}
