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

// T6 = 确定性多切片平台及格线（决策记录 D2/D3）。
// 故意避开任何模糊的量化策略语义：每个切片都是「输入→输出」可逐例断言的确定性契约
// （数据管道 / CRUD / 状态机），用于隔离「平台正确性」与「量化语义模型能力」——
// 若 T6 能稳定连续 strict pass，即证主干架构 OK，T4 卡点在量化语义的模型能力而非引擎。
const T6_USER_INPUT = `用 Python 开发一个「任务清单（Todo）批处理 CLI」MVP。这是一个**确定性**任务：所有行为都有精确、可逐例断言的契约，不涉及任何统计/数值/策略类模糊语义。

按 software 多切片组织，先做架构决策，再实现并验证以下垂直切片，最后用 main.py 串联：

1. models/（数据模型 + 校验）
   - dataclass \`Task\`，字段：id:int、title:str、status:str、priority:int。
   - \`validate_task(data: dict) -> list[str]\`：返回错误信息列表（空列表表示合法）。规则：title 必须为非空字符串；status 必须属于 {"todo","in_progress","done","cancelled"}；priority 必须是 1..5 的整数。每违反一条加一条错误信息。

2. store/（CRUD 仓储 + JSON 持久化）
   - \`TaskStore\` 类，内存自增整数 id（从 1 开始）。
   - 方法：\`add(title:str, priority:int=3) -> int\`（创建一条 status="todo" 的任务，返回新 id）、\`get(task_id:int) -> dict | None\`、\`update(task_id:int, **fields) -> bool\`、\`delete(task_id:int) -> bool\`、\`list_all() -> list[dict]\`（按 id 升序）。
   - 持久化：\`save_json(path:str) -> None\`、\`load_json(path:str) -> None\`（覆盖式加载，恢复后 next_id 取最大 id+1）。

3. statemachine/（状态机）
   - \`ALLOWED_TRANSITIONS\`：todo→in_progress、in_progress→done、todo→cancelled、in_progress→cancelled。
   - \`can_transition(frm:str, to:str) -> bool\`。
   - \`apply_transition(task:dict, to:str) -> dict\`：合法则返回 status 更新后的任务；非法则抛 \`InvalidTransition\`（自定义异常）。

4. pipeline/（CSV 数据管道）
   - \`import_tasks_from_csv(csv_path:str, store) -> dict\`：读取含表头 title,priority,status 的 CSV，逐行用 models.validate_task 校验；合法行写入 store（status 缺省按 "todo"），非法行跳过；返回 {"imported": n_ok, "skipped": n_bad}。
   - \`summarize(store) -> dict\`：返回各 status 的计数，形如 {"todo":x,"in_progress":y,"done":z,"cancelled":w}。

5. main.py / cli：读取 config.yaml（含 csv_path、output_json_path），调用 pipeline 导入、写出 summarize 结果到 output_json。
6. 交付：config.yaml、models/、store/、statemachine/、pipeline/、main.py、tests/（pytest 覆盖每个切片的契约与边界）、DELIVERY.md。
7. 依赖：仅 PyYAML 用于读取 config.yaml；其余一律使用 Python 标准库（csv、json、dataclasses、enum）。不接任何外部服务；CSV 样例可自带 fixture。`

// T7 = 工程进度与财务管控系统（对比 OpenHands/AI Studio 的同一清晰业务任务）。
// 确定性业务 CRUD：进度管控 + 财务匹配 + 进度预警 + 预算预警 + 月度报表。
// 与 T6 同属"可规约"靶子，但更贴近真实小软件；用于三方横向对比（同 DeepSeek 模型 vs OpenHands）。
const T7_USER_INPUT = `用 Python 开发一个「工程进度与财务管控系统」MVP（命令行 / 后端，电脑本地使用，不做 GUI）。这是一个**确定性业务系统**：所有计算都有精确、可逐例断言的契约，不涉及任何统计/预测类模糊语义。

按 software 多切片组织，先做架构决策，再实现并验证以下垂直切片，最后用 main.py 串联：

1. models/（数据模型 + 校验，标准库 dataclasses）
   - \`Project\`(id:int, name:str, budget:float, start_date:str, end_date:str, status:str)
   - \`Milestone\`(id:int, project_id:int, name:str, weight:float, planned_end:str, status:str)  # status ∈ {"pending","in_progress","done"}
   - \`FinanceRecord\`(id:int, project_id:int|None, category:str, amount:float, record_type:str, record_date:str)  # record_type ∈ {"income","expense"}
   - \`Budget\`(id:int, project_id:int, category:str, planned_amount:float, fiscal_month:str)  # fiscal_month 形如 "2026-06"
   - 每个模型提供 validate(data:dict) -> list[str]，返回错误信息列表（空表示合法）。

2. store/（CRUD 仓储 + JSON 持久化，标准库）
   - 对 Project/Milestone/FinanceRecord/Budget 提供 add/get/update/delete/list 方法，内存自增 id。
   - save_json(path)/load_json(path) 覆盖式持久化，恢复后 next_id 取最大 id+1。

3. progress/（进度管控）
   - \`project_progress(store, project_id) -> dict\`：按里程碑 weight 加权计算完成百分比 = sum(done.weight)/sum(all.weight)*100；返回 {"percent":x, "total_weight":w}。total_weight 为 0 时 percent=0。

4. finance/（财务数据匹配）
   - \`match_records_to_budget(store, project_id, fiscal_month) -> dict\`：把该项目该月的 expense 财务记录按 category 汇总，与对应 Budget.planned_amount 配对；返回 {category: {"planned":p, "actual":a, "exec_rate": a/p*100}}（p 为 0 时 exec_rate=0）。

5. alerts/（进度预警 + 财务预算预警）
   - \`progress_alerts(store, today:str) -> list[dict]\`：按时间应完成比例（elapsed/total_days）对比实际 percent，滞后>20% 记 level="danger"，>10% 记 level="warning"。
   - \`budget_alerts(store, fiscal_month) -> list[dict]\`：exec_rate>=100 记 level="danger"，>=80 记 level="warning"。

6. report/（月度报表）
   - \`monthly_report(store, fiscal_month) -> dict\`：返回 {"fiscal_month":fm, "income_total":x, "expense_total":y, "balance":x-y, "project_costs":[{project_id,name,cost}], "budget_execution":[...] }。

7. main.py / cli：读取 config.yaml（含 data_json 路径、当前 fiscal_month），加载/初始化 store，输出当月 monthly_report 到 output_json，并打印 progress_alerts + budget_alerts 数量。
8. 交付：config.yaml、models/、store/、progress/、finance/、alerts/、report/、main.py、tests/（pytest 覆盖每个切片的契约与边界，含一份自带 fixture 数据）、DELIVERY.md。
9. 依赖：仅 PyYAML 读取 config.yaml；其余用 Python 标准库（csv、json、dataclasses、datetime、enum）。不接任何外部服务/数据库驱动；样例数据自带 fixture（可用 JSON 种子）。`

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
  6: {
    id: 'live-t6-deterministic-platform',
    label: 'T6 平台及格线：确定性多切片（CRUD+状态机+数据管道）',
    taskType: 'software',
    userInput: T6_USER_INPUT,
    polish: true,
    timeoutMs: 2_400_000,
    generationAttempts: 2,
    // 确定性靶子：覆盖 T4 量化 module dirs / traceability，使 strict 验收只考平台正确性。
    mvp: {
      moduleDirs: ['models', 'store', 'statemachine', 'pipeline'],
      // ADR-0008 决策3：fixture 一致性——CSV 表头须覆盖任务字段（拦截种子污染，如误用 T4 期货 CSV）。
      fixtures: [{ file: 'tasks.csv', requireColumns: ['title', 'priority', 'status'] }],
      // ADR-0008：真实集成冒烟——跑 main 入口，断言 summary 产出非「全 0/空」（捕获空心绿）。
      smoke: { run: 'main', outputFile: 'summary.json', jsonNotAllZero: true },
      // ADR-0009：交付前架构扫——检测占位导出（自赋值 / JS 风格别名）等烂泥球。
      architectureScan: true,
      traceability: [
        {
          id: 'crud-store',
          dirs: ['store', 'tests'],
          requireDirPy: 'store',
          pattern: /\bdef\s+(add|get|update|delete|list_all|save_json|load_json)\b/,
          hint: 'store/ 非空且含 add/get/update/delete/list_all/save_json/load_json CRUD 方法',
        },
        {
          id: 'state-machine',
          dirs: ['statemachine', 'tests'],
          requireDirPy: 'statemachine',
          pattern: /can_transition|apply_transition|ALLOWED_TRANSITIONS|InvalidTransition/,
          hint: 'statemachine/ 含 can_transition / apply_transition / ALLOWED_TRANSITIONS / InvalidTransition',
        },
        {
          id: 'csv-pipeline',
          dirs: ['pipeline', 'tests'],
          requireDirPy: 'pipeline',
          pattern: /import_tasks_from_csv|summarize|csv/i,
          hint: 'pipeline/ 含 import_tasks_from_csv / summarize（CSV 数据管道）',
        },
      ],
    },
    pass: {
      terminal: 'workflowCompleted',
      strict: true,
      minStages: 6,
      // 5 切片（models/store/statemachine/pipeline/main）+ skeleton-compiler venv/verify 链；
      // 留余量避免确定性任务在 generate 计数边界假失败（量化 T4 用 55）。
      maxStages: 60,
    },
  },
  7: {
    id: 'live-t7-project-finance-mgmt',
    label: 'T7 三方对比：工程进度与财务管控系统（CRUD+匹配+预警+月报）',
    taskType: 'software',
    userInput: T7_USER_INPUT,
    polish: true,
    timeoutMs: 2_400_000,
    generationAttempts: 2,
    mvp: {
      moduleDirs: ['models', 'store', 'progress', 'finance', 'alerts', 'report'],
      // 真实集成冒烟：跑 main 入口，断言月报产出非「全 0/空」（捕获空心绿）。
      smoke: { run: 'main', outputFile: 'output.json', jsonNotAllZero: true },
      architectureScan: true,
      traceability: [
        {
          id: 'progress-calc',
          dirs: ['progress', 'tests'],
          requireDirPy: 'progress',
          pattern: /project_progress|weight/,
          hint: 'progress/ 含 project_progress（里程碑权重加权进度）',
        },
        {
          id: 'finance-match',
          dirs: ['finance', 'tests'],
          requireDirPy: 'finance',
          pattern: /match_records_to_budget|exec_rate/,
          hint: 'finance/ 含 match_records_to_budget（财务↔预算匹配）',
        },
        {
          id: 'alerts',
          dirs: ['alerts', 'tests'],
          requireDirPy: 'alerts',
          pattern: /progress_alerts|budget_alerts/,
          hint: 'alerts/ 含 progress_alerts / budget_alerts（进度+预算预警）',
        },
        {
          id: 'monthly-report',
          dirs: ['report', 'tests'],
          requireDirPy: 'report',
          pattern: /monthly_report/,
          hint: 'report/ 含 monthly_report（月度报表聚合）',
        },
      ],
    },
    pass: {
      terminal: 'workflowCompleted',
      strict: true,
      minStages: 6,
      // 6 切片（models/store/progress/finance/alerts/report）+ main + skeleton-compiler 链；
      // 6 切片 × decide/test_write/gate/impl/test_run/fix + venv/verify/smoke/delivery，留足余量。
      maxStages: 96,
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
    // T6 是独立的平台及格线靶子，不纳入 all 量化链路（避免与 T4/T5 混算 strict）。
    return [1, 2, 3, 4, 5]
  }
  const n = Number(tier)
  if (![1, 2, 3, 4, 5, 6, 7].includes(n)) {
    throw new Error(`--live-tier must be 1, 2, 3, 4, 5, 6, 7, or all (got: ${tier})`)
  }
  return [n]
}

/** T4/T5 档位使用迭代工作区。 */
export function isT4FamilyTier(tierNum) {
  return tierNum === 4 || tierNum === 5
}
