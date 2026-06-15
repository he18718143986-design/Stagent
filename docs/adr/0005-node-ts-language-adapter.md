# ADR-0005: Node/TS 语言适配（测试质量 + 栈引导 + 交付）

## 状态

Proposed — 2026-06-15

## 背景

Stagent 引擎的 Strict QA 与 disk-bootstrap 当前以 **Python 交付**为主：

- 测试质量门禁 `TestQualityLint.ts` 是**硬编码正则**，假设以 Python/pytest 为主（`sys.modules` 劫持、`np.nan` 身份比较、`pytest.raises(..., match=)`、`from indicators import` 等）。
- 引导链路偏 Python：`python-bootstrap/`（venv）、`pythonConftestStage.ts`、`injectPythonModuleStubStages.ts`。
- live 任务 T1–T6 全部是 Python（见 `scripts/headless/lib/live-tasks.mjs`）。

但仓库**已经具备 Node/TS 的关键零件**，使「让 Node/TS 成为一等交付目标」从大改降级为可控增量：

- **栈探测已就绪**：`python-bootstrap/pythonStackDetect.ts` 中已有
  - `workflowSignalsNodeJsStack(wf)`：识别 jest/npm test 命令、`.ts/.tsx/.js/.jsx/.mjs/.cjs` 落盘文件、server npm install。
  - `isJsTestRunCommand(cmd)`（`plan-completeness/testInfraChecks.ts`）、`NODE_IMPL_EXT`。
  - `isPythonOnlyWorkflow(wf)`：检测到 Node 信号即返回 `false`，已能把 Node 工作流与 Python 工作流区分开。
- **npm 引导雏形**：`disk-bootstrap/initNpmStages.ts`、`disk-bootstrap/npmWorkspace.ts`。
- **语言适配接缝**：`language-adapter/LanguageTestQualityAdapter.ts`（接口 `id` / `looksLikeTest` / `detectFindings`）+ `language-adapter/python/pythonTestQualityAdapter.ts`（已把 Python 检测器收敛到接缝，行为与 `TestQualityLint` 逐条等价）。

**关键现状缺口**：`LanguageTestQualityAdapter` 接缝**尚未接入生效路径**——线上仍由硬编码的 `TestQualityLint.lintTestQuality` 执行；且不存在 `nodeTestQualityAdapter`。

## 目标

让 Node/TS 工作流走 `npm install` + `tsc --noEmit` + `vitest run` 的反馈回路，并以 Node 语义做测试质量门禁（防假绿），使便宜模型（DeepSeek）也能稳定产出**可运行的 TS 工程**。

## 决策

### 1. 实现 `nodeTestQualityAdapter`（language-adapter/node/nodeTestQualityAdapter.ts）

实现 `LanguageTestQualityAdapter`：`id: 'node'`、`looksLikeTest`、`detectFindings`，覆盖 `TestQualityFindingKind` 全部 9 种坏味的 TS/JS 形态。**只负责「如何在 TS/JS 里识别坏味」**；坏味的 `type`/`hard` 分级仍由 core policy（`TestQualityLint`）决定，与 python adapter 同构。

`looksLikeTest(code)`（node）匹配以下任一信号（实现时合成单个正则，注意避免在文档里写出 `]` 紧邻 `(` 的序列）：

- `describe(` / `it(` / `test(`
- `expect(`
- 从 `vitest` 或 `@jest/globals` 的 import 语句
- `require('vitest')` / `require('@jest...')`

检测器 → TS/JS 形态映射（与 `pythonTestQualityAdapter` 一一对应）：

| kind | Python 形态（现有） | Node/TS 形态（本 ADR） |
|------|---------------------|------------------------|
| `no-assertion` | 无 `assert/expect(` | `looksLikeTest` 但无 `expect(` / `assert(` / `assert.\w+(` |
| `tautological-assertion` | `assert True` / `1==1` | `expect(true).toBe(true)`、`expect(1).toBe(1)`、`expect('x').toBe('x')`、`assert.ok(true)` |
| `existence-only` | 全部断言为 `is not None` | 全部断言为 `toBeDefined()` / `not.toBeUndefined()` / `not.toBeNull()` / `toBeTruthy()`（无实质值断言） |
| `implementation-detail` | `assert obj._private` | `expect(obj._private)` / `obj['_x']` / 访问 `#private` 字段 |
| `missing-production-import` | 无 `from <prod> import` | 无 `import ... from '<prod>'` / `require('<prod>')`（`<prod>` 参数化，见决策 3） |
| `inline-impl-double` | 测试内联 `class X` 且无生产 import | 测试内联 `class X` / `function impl()` 定义被测实现且无生产 import |
| `internal-module-mock` | `@patch('<prod>.x')` | `vi.mock('<prod>')` / `jest.mock('<prod>')` 指向项目内模块 |
| `module-system-hijack` | `sys.modules['<prod>']=` | 篡改 `require.cache[...]=`、`vi.doMock('<prod>', factory)` 用整体替身覆盖被测模块本体、`Module._load` 覆写 |
| `brittle-assertion` | `is np.nan`、`pytest.raises(..., match=)` | `=== NaN`（恒 false，应 `Number.isNaN`）、`.toThrow(/精确内置错误消息/)`（随 Node/库版本漂移）、（可选）浮点严格相等 `toBe(0.1+0.2)` |

`looksLikeTest` 守卫与报告顺序**严格对齐** python adapter（各子探测各自决定是否需要守卫）。

### 2. 把 `LanguageTestQualityAdapter` 接缝接入生效路径

- `TestQualityLint.lintTestQuality(testCode, options)` 改为：**policy 不变**，detector 走 adapter。新增 `options.adapter?: LanguageTestQualityAdapter` 或 `options.language?: 'python' | 'node'`。
- 新增 `selectTestQualityAdapter(language)`：返回 `python`/`node` adapter，**默认 `python`**（向后兼容，现有 Python 测试零行为变化）。
- 调用方（`quality-gates/postStageGates.ts`、`WorkflowEngineWorkspaceLint.ts`）按工作流语言信号（`isPythonOnlyWorkflow` / `workflowSignalsNodeJsStack`）选 adapter 注入。
- policy（kind → `TestQualityWarningType` + `hard` 分级）保持单一真源，python/node 共用，避免分叉。

### 3. 生产模块名参数化（消除 Python 硬编码假设）

`pythonTestQualityAdapter` 把 `indicators/signals/risk/broker/src/main` 硬编码进 detector。`TestQualityLint` 已有 `productionModules` 参数化 + `moduleAlternation`（缺省回退默认表）。node adapter **必须参数化** `productionModules`（从切片语义注入），否则 Node 任务（如 Todo CLI 的 `models/store/...`）会被默认 Python 模块表误判。
- 后续可把 python adapter 也迁到参数化，统一从 `TestQualityLint` 传入。

### 4. Node 栈引导链路

- Node 工作流（`isPythonOnlyWorkflow === false`）：
  - 引导走 `initNpmStages` / `npmWorkspace`（`npm install`），跳过 venv/conftest/pytest 专属阶段（已由 `isPythonOnlyWorkflow` 门控）。
  - `test_run` 命令用 `vitest run`（或 `npm test`）；可加 `tsc --noEmit` 作为 preflight 类型门禁。
- Node 版「模块 stub 注入」（对标 `injectPythonModuleStubStages`）作为 **follow-up**，首版可不做（让 LLM 直接产出 TS 模块）。

### 5. 交付 zip（follow-up，独立 ADR）

`deliveryWrapupStage`（现仅产 `DELIVERY.md`）之后追加归档阶段，产出 `deliverable/<name>.zip`（构建 + `run.sh` + README），并在 `DefinitionOfDone` 加「解压可启动」校验。**不在本 ADR 范围**，单独立项。

## 实施顺序（TDD）

1. 写 `nodeTestQualityAdapter.test.ts`（见附录用例清单）→ red。
2. 实现 `nodeTestQualityAdapter.ts` → green。
3. `TestQualityLint` 接入 adapter seam + `selectTestQualityAdapter`（保持 python 默认绿）。
4. 调用方按语言信号注入 adapter；加 node 工作流的 `lintTestQuality` 集成测。
5. Node 栈引导（vitest/tsc）+ 新增 Node 确定性 live tier（对标 T6）验证端到端。

## 后果

- **正向**：Node/TS 成为一等交付目标；policy 单一真源、python 行为不变；新增语言 = 加一个 adapter。
- **风险**：TS 的 `module-system-hijack` 比 Python `sys.modules` 更隐蔽（多种篡改方式），首版检测器可能漏检——以 `hard` 谨慎、warning 优先，靠用例迭代补全。
- **兼容**：`lintTestQuality` 默认 `python`，存量调用零改动；node 行为仅在显式注入语言时启用。

---

## 附录 A：`nodeTestQualityAdapter` 测试用例清单

文件：`packages/stagent-core/src/test/node-test-quality-adapter.test.ts`（vitest）。
组织原则：**每种 finding kind 至少 1 个阳性（应检出）+ 1 个阴性（不应误报）**；并覆盖 `looksLikeTest` 与报告顺序。`productionModules` 在用例中显式传 `['models','store']` 之类，验证参数化。

### A0. `looksLikeTest`
- [P] `describe('x', () => { it('y', () => {}) })` → true
- [P] `test('y', () => { expect(1).toBe(1) })` → true
- [P] `import { expect } from 'vitest'` + `expect(a).toEqual(b)` → true
- [N] 纯实现文件 `export function add(a,b){return a+b}` → false
- [N] 仅注释/类型声明、无 it/test/expect → false

### A1. `no-assertion`
- [P] `it('does x', () => { const r = add(1,2) })`（无 expect/assert）→ 检出 no-assertion
- [N] `it('does x', () => { expect(add(1,2)).toBe(3) })` → 不检出
- [N] 非测试代码（looksLikeTest=false）→ 不检出（守卫）

### A2. `tautological-assertion`
- [P] `expect(true).toBe(true)` → 检出
- [P] `expect(1).toBe(1)` → 检出
- [P] `assert.ok(true)` → 检出
- [N] `expect(result).toBe(true)`（变量，非字面量）→ 不检出
- [N] `expect(sum).toBe(3)` → 不检出

### A3. `existence-only`
- [P] 测试内全部断言为 `expect(mod).toBeDefined()`（无其它实质断言）→ 检出
- [P] 全部为 `expect(x).not.toBeNull()` / `toBeTruthy()` → 检出
- [N] `expect(mod).toBeDefined(); expect(mod.run()).toBe(42)`（混有实质断言）→ 不检出 existence-only（可能检出别的或不检出）
- [N] 无断言（应归 A1 而非 A3）→ 不检出 existence-only

### A4. `implementation-detail`
- [P] `expect(obj._private).toBe(1)` → 检出
- [P] `expect(obj['_internal']).toBeTruthy()` → 检出
- [N] `expect(obj.publicValue).toBe(1)` → 不检出
- 注：与 A3 互斥逻辑对齐 python（existence-only 命中时不再报 implementation-detail）

### A5. `missing-production-import` + A6. `inline-impl-double`
- [P] 测试内 `class TaskStore { add(){...} }`（内联 impl）且无 `import ... from '../store'` → 同时检出 missing-production-import + inline-impl-double（productionModules=['store']）
- [P] 测试内 `function validateTask(){...}` 内联实现 + 无生产 import → 检出
- [N] `import { TaskStore } from '../src/store'` + 测试使用之 → 不检出
- [N] 内联的是 `class TestHelper`（以 Test/前缀，非被测实现）→ 不检出（对齐 python `!startsWith('Test')`）

### A7. `internal-module-mock`
- [P] `vi.mock('../store')`（指向生产模块）→ 检出
- [P] `jest.mock('@/models')` → 检出
- [N] `vi.mock('axios')` / `vi.mock('node:fs')`（第三方/内置，非项目模块）→ 不检出
- 参数化：productionModules 决定哪些算「项目内」

### A8. `module-system-hijack`
- [P] `require.cache[require.resolve('../store')] = { exports: fakeStore }` → 检出
- [P] `vi.doMock('../store', () => fakeStoreModule)`（整体替身覆盖被测模块本体）→ 检出
- [N] `vi.doMock('axios', ...)`（第三方）→ 不检出
- [N] 正常 `vi.spyOn(store, 'add')`（部分桩，非整体劫持）→ 不检出（首版策略：spyOn 不算 hijack）

### A9. `brittle-assertion`
- [P] `expect(x === NaN).toBe(false)` / `if (v === NaN)` → 检出（应改 Number.isNaN）
- [P] `expect(() => f()).toThrow('Cannot read properties of undefined')`（内置错误原文）→ 检出
- [N] `expect(() => f()).toThrow(MyCustomError)`（自定义异常类型）→ 不检出
- [N] `expect(Number.isNaN(x)).toBe(true)` → 不检出

### A10. 报告顺序 & 聚合
- [P] 一段同时含 no-assertion 之外多种坏味的测试 → `detectFindings` 返回顺序与 python adapter 对齐（assertion 类 → production-binding → internal-mock → module-hijack → brittle）
- [P] 空字符串 / 空白 → 返回 `[]`
- [P] `productionModules` 传空 → 回退默认表行为不崩（与 TestQualityLint 一致）

### A11. seam 接入（集成，TestQualityLint）
- [P] `lintTestQuality(tsTestCode, { language: 'node', productionModules })` → 命中 node 形态、`hard` 分级由 policy 给出（如 no-assertion=hard）
- [P] `lintTestQuality(pyTestCode)`（默认）→ 行为与现状逐条等价（回归保护）
- [P] node 工作流经 `postStageGates` → 选 node adapter；python 工作流 → 选 python adapter

---

## 附录 B：Node 确定性 live tier 任务定义草案（对标 T6）

为验证 Node/TS 端到端的「平台正确性」，新增一个**确定性** Node tier（如 `T6n`），与 Python T6 同构（CRUD + 状态机 + CSV 管道），但用 **TypeScript + vitest**。落地位置：`scripts/headless/lib/live-tasks.mjs` 的 `LIVE_TASK_TIERS`。

### userInput 草案

```
用 TypeScript 开发一个「任务清单（Todo）批处理 CLI」MVP。这是一个**确定性**任务：
所有行为都有精确、可逐例断言的契约，不涉及任何统计/数值/策略类模糊语义。
按 software 多切片组织，先做架构决策，再实现并验证以下垂直切片，最后用 src/main.ts 串联：

1. models/（数据模型 + 校验）
   - 接口 Task { id:number; title:string; status:string; priority:number }
   - validateTask(data: unknown): string[]：返回错误信息列表（空数组=合法）。
     规则：title 非空字符串；status ∈ {"todo","in_progress","done","cancelled"}；priority 为 1..5 整数。每违反一条加一条。
2. store/（CRUD 仓储 + JSON 持久化）
   - class TaskStore，内存自增 id（从 1 开始）。
   - add(title,priority=3):number、get(id):Task|null、update(id,fields):boolean、remove(id):boolean、listAll():Task[]（按 id 升序）。
   - saveJson(path):void、loadJson(path):void（覆盖式加载，nextId=最大 id+1）。
3. statemachine/（状态机）
   - ALLOWED_TRANSITIONS：todo→in_progress、in_progress→done、todo→cancelled、in_progress→cancelled。
   - canTransition(from,to):boolean。
   - applyTransition(task,to):Task：合法则返回 status 更新后的任务；非法抛 InvalidTransition。
4. pipeline/（CSV 数据管道）
   - importTasksFromCsv(csvPath, store):{imported:number; skipped:number}：读含表头 title,priority,status 的 CSV，
     逐行用 models.validateTask 校验；合法行入 store（status 缺省 "todo"），非法行跳过。
   - summarize(store):{todo:number;in_progress:number;done:number;cancelled:number}。
5. src/main.ts / cli：读 config.json（含 csvPath、outputJsonPath），调用 pipeline 导入、写出 summarize 结果。
6. 交付：config.json、src/models/、src/store/、src/statemachine/、src/pipeline/、src/main.ts、
   tests/（vitest 覆盖每个切片的契约与边界）、package.json（scripts.test=vitest run）、tsconfig.json、DELIVERY.md。
7. 依赖：仅标准库 + vitest（devDependency）。不接任何外部服务；CSV 样例自带 fixture。
```

### tier 配置草案（对照 T6）

```js
'6n': {
  id: 'live-t6n-deterministic-node',
  label: 'T6n 平台及格线：确定性多切片（Node/TS：CRUD+状态机+管道）',
  taskType: 'software',
  userInput: T6N_USER_INPUT,
  polish: true,
  timeoutMs: 2_400_000,
  generationAttempts: 2,
  mvp: {
    moduleDirs: ['src/models', 'src/store', 'src/statemachine', 'src/pipeline'],
    traceability: [
      { id: 'crud-store', dirs: ['src/store', 'tests'], requireDirTs: 'src/store',
        pattern: /\b(add|get|update|remove|listAll|saveJson|loadJson)\s*\(/,
        hint: 'src/store 含 add/get/update/remove/listAll/saveJson/loadJson CRUD' },
      { id: 'state-machine', dirs: ['src/statemachine', 'tests'], requireDirTs: 'src/statemachine',
        pattern: /canTransition|applyTransition|ALLOWED_TRANSITIONS|InvalidTransition/,
        hint: 'src/statemachine 含 canTransition/applyTransition/ALLOWED_TRANSITIONS/InvalidTransition' },
      { id: 'csv-pipeline', dirs: ['src/pipeline', 'tests'], requireDirTs: 'src/pipeline',
        pattern: /importTasksFromCsv|summarize/,
        hint: 'src/pipeline 含 importTasksFromCsv/summarize（CSV 数据管道）' },
    ],
  },
  pass: { terminal: 'workflowCompleted', strict: true, minStages: 6, maxStages: 60 },
},
```

### 依赖项（实现 T6n 前需就绪）

- `requireDirTs`（或复用 `requireDirPy` 的语言无关版）：mvp-acceptance 的目录非空 + 模式校验需支持 `.ts` 文件扫描（现 `requireDirPy` 仅扫 `.py`）。
- Node 栈引导（决策 4）：`npm install` + `vitest run` 作为 test_run。
- node test 质量 adapter（决策 1–2）已接入生效路径，确保 strict QA 用 Node 语义防假绿。
- `resolveLiveTiers` / `--live-tier` 需接受 `6n`（或用数字位 7）。

### 验收

- `LLM_MODEL=deepseek-v4-flash` + `LLM_MODEL_TEST_WRITE=deepseek-v4-pro` 下，`feedback:live --live-tier 6n` 能 strict pass，且解压产物 `npm i && npm test` 全绿——即证 Node 平台正确性 + difficulty-router 成本配置有效。

---

## 附录 C：第一步落地 PR 拆分清单（nodeTestQualityAdapter）

原则：**小而可独立 review、每个 PR 保持构建与测试绿、python 行为零回归**。基线参照：核心套件 9 个预存失败（见 `docs/live-findings-2026-06-15.md`），任何 PR 不得新增失败；根 vitest 195/195 保持。范围限定「测试质量 adapter 的实现/接线/测试」，Node 栈引导（npm/vitest）与 T6n tier 属后续 PR。

### PR-1：纯实现 `nodeTestQualityAdapter` + 单测（零接线、零行为变更）

- 新增 `packages/stagent-core/src/language-adapter/node/nodeTestQualityAdapter.ts`，实现 `LanguageTestQualityAdapter`（`id:'node'`、`looksLikeTest`、`detectFindings`），检测器按附录 A 的 Python→Node 映射。`productionModules` 参数化（不硬编码）。
- 新增 `packages/stagent-core/src/test/node-test-quality-adapter.test.ts`，落地附录 A 的 A0–A10 用例（每 kind 阳性+阴性）。
- **不**被任何生效路径引用 → 对运行零影响。
- 验收：新测试全绿；`build:core` 通过；核心套件失败数仍为基线值。
- 风险：极低（纯新增、孤立）。

### PR-2：`TestQualityLint` 支持按语言选 detector（默认 python，向后兼容）

- 改 `packages/stagent-core/src/TestQualityLint.ts`：抽出 `selectTestQualityAdapter(language?)`（缺省 `python`）；`lintTestQuality(testCode, options)` 新增 `options.language?: 'python'|'node'`（或 `options.adapter`）。policy（kind→`TestQualityWarningType`+`hard`）保持单一真源。
- 把现有硬编码 Python 检测改为委托 `pythonTestQualityAdapter`（行为逐条等价），node 走 `nodeTestQualityAdapter`。
- 测试：新增「默认 = python，行为与重构前逐条等价」回归用例（附录 A11 python 分支）；node 分支基本用例。
- 验收：**python 路径零行为变化**（关键回归保护）；node 路径生效；核心套件失败数仍为基线值。
- 风险：中（触碰生效门禁）——以「python 等价回归」用例兜底。

### PR-3：调用方按工作流语言信号注入 adapter

- 改调用方 `quality-gates/postStageGates.ts`、`WorkflowEngineWorkspaceLint.ts`：用 `workflowSignalsNodeJsStack` / `isPythonOnlyWorkflow`（已存在于 `python-bootstrap/pythonStackDetect.ts`）判定语言，向 `lintTestQuality` 传 `language` 与切片语义的 `productionModules`。
- 测试：集成用例——node 工作流经 `postStageGates` 选 node adapter、python 工作流选 python adapter（附录 A11）。
- 验收：python 工作流门禁行为不变；node 工作流用 Node 语义防假绿；核心套件失败数仍为基线值。
- 风险：中（连通端到端）。

### 顺序与依赖

```
PR-1 (孤立实现+测试)  →  PR-2 (seam 接入, 默认 python)  →  PR-3 (调用方按语言注入)
```

每个 PR 单独可合、可回滚。PR-1 合入后即便不接 PR-2/3 也无副作用（死代码但有测试守护）。

### 后续 PR（超出「第一步」，单独立项）

- PR-4：Node 栈引导（`initNpmStages` 接 `npm install` + `tsc --noEmit` + `vitest run` 作 test_run；跳过 venv/conftest/pytest）。
- PR-5：Node 确定性 live tier `T6n`（附录 B）+ `requireDirTs` 目录扫描支持 `.ts`。
- PR-6：zip 交付（ADR 决策 5，独立 ADR）。
