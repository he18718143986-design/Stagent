# Live 验证发现（2026-06-15）

基于 commit `8d09371`（HEAD），在本地用真实 DeepSeek API 跑通基线并定位 T6 失败根因。供后续会话/交接参考。

## 基线（mock，无需 API key）

- `npm install` → 644 包，exit 0（13 条 audit 告警，非阻塞）。
- `npm run build:core` → tsc 无报错。
- `npm test` → **24 文件 / 195 测试全过**。
- `npm run feedback`（mock）→ **6/6 全过**（construct / polish / generate / execute / charter-suggest / charter-auto）。

## 真实 API 通路

- 配置：`.env.local`（被 `.gitignore` 的 `*.local` 忽略）放 `DEEPSEEK_API_KEY`；headless `run.mjs` 自动加载，已 export 的环境变量优先。
- 默认 base url 已是 `https://api.deepseek.com/v1`；脚本内置默认模型 `deepseek-chat`（2026-07-24 退役），应显式用 `deepseek-v4-flash` / `deepseek-v4-pro`。
- `npm run feedback:live`（T1，flash）→ **1/1 pass**，106s，10 stages，5 次 LLM 调用。真实全链路（generate→execute→QA）通。

## T6 失败根因（确定性平台及格线）

- `npm run feedback:live:t6`（`LLM_MODEL=deepseek-v4-flash`，无角色覆盖）→ **0/1**。
- 失败点：`stage_decide_pipeline` 经 `DecisionLintGate` 重试 4 次仍被拒：
  - I-17：决策清单缺「### AI 无法验证的假设」节。
  - I-18：「边界压力测试」节场景不足（1，需 ≥2）。
- 结论：失败在 **decide 上游**，根因是 **flash 在结构化决策契约上的能力**，非引擎/实现 bug——与引擎注释（`run.mjs` L651-654）预言一致。
- 附带：日志有 `missing l10n key: stagent.planCompleteness.missingPython*` 告警（缺翻译键的小 bug，非本次失败原因，待补）。

## 关键架构发现

- **难度感知模型路由已存在于引擎**（「异族出题人」）：`llmModelByRole`（角色 `decision` / `test-write` / `integration`）+ `readPreferredModelByRole` + invoker 回退，已有测试 `agent-role-model-routing.test.ts`。耦合只在 headless `run.mjs` 把三角色绑死到 `LLM_MODEL_TEST_WRITE`。详见 [ADR-0006](adr/0006-difficulty-aware-model-routing.md)。
- **Node/TS 适配的接缝多已就绪**：栈探测 `workflowSignalsNodeJsStack` / `isJsTestRunCommand`、npm 引导 `initNpmStages`/`npmWorkspace`、测试质量接缝 `LanguageTestQualityAdapter`（但生效路径 `TestQualityLint` 仍硬编码、未接 seam，且无 node adapter）。详见 [ADR-0005](adr/0005-node-ts-language-adapter.md)。

## 已知预存核心测试失败（基线，非本次回归）

`node --test packages/stagent-core/dist/test/*.test.js` 在 **clean checkout（commit `8d09371`）** 下即 **9 fail / 927 pass / 938 tests**。这些与本次改动无关（`git stash` 对比确认），后续如遇到不要误判为回归：

- `detectAdrCriteria: calibration rows match label`
- `evaluateAdrDetector: adr recall >= 95% and non-adr FP <= 5%`
- `loadAdrCalibrationQuestions: seed jsonl validates label/features consistency`
- `fixture experiences produce >=3 actionable pattern kinds`
- `analyze-experiences script runs on fixture workspace copy`
- `validateGeneratedWorkflow rejects test_run importing missing config module`
- `verifyRule20 warns prototype impl missing file-read followup`
- `verify-rule20 warns software-missing-global-architecture-decision when keywords hit §7.8`
- `verify-rule20 clears global-architecture warning when stage_decide_architecture_overview present`

（另：`npm run docs:check` 在 clean checkout 下也已 RED —— `docs/STAGENT-PRD.md` 指向仓库外 `../../stagent_docs/*`，同属预存问题。）

## 全 pro 重跑结果（`LLM_MODEL=deepseek-v4-pro`）

- `feedback:live:t6`（全 pro）→ **0/1**，但失败点**前移**：decide **通过了**（pro 跨过了 flash 卡住的决策门），改在更下游的 **module-contract 门**失败：
  - `workflowFailed: module-contract（python-forward-slice-import）`：`store/__init__.py` 顶层 `import statemachine`，但 store 切片落盘时 `statemachine/` 尚未生成 → 违反「前向切片 import」契约。
- 结论：
  1. **难度路由假设证实**——decide 阶段确需强模型；pro 跨过了 flash 的决策能力墙。
  2. **但 T6 strict-green 还有第二道阻碍**：codegen 反复产出「顶层跨切片 import 未来切片」，被结构门拦截。这是**代码生成纪律/排序**问题（非 decide 能力），需在引擎侧加约束（prompt + lazy-import/可注入 callable 指引，或 self-heal/replan 兜底）。

## forward-slice 修复（已落地，2026-06-15）

第二阻碍 `python-forward-slice-import` 的根因不是模型能力，而是**指引时机**：

- 「禁止顶层 import 未落盘后续切片」的指引**只在 fix 阶段、且只在 pytest 报 `No module named` 时**注入（`fixRoutingPromptSuffix` + `buildForwardSliceImportFixHints`，后者 gate 在 `/No module named/`）。
- 但静态门 `lintForwardSliceImportsInImpl`（`sliceContractGateHelpers` post-mutate，hard block）在 **pytest 之前**就拦截，初始 impl 阶段**从未被告知** → 模型反复生成顶层前向 import → 撞门 `workflowFailed`。

修法（把预防前移到初始 impl prompt）：

- 新增 `buildForwardSliceImportPreventionSuffix({ currentSemantic, sliceOrder })`（`python-contract/ForwardSliceImportLint.ts`）：列出当前切片之后尚未落盘的切片 + 规则（lazy import / 可注入 callable / main 装配），无后续切片返回 null。
- 接线 `stage-runners/LlmTextInvokeStep.ts` 的 `isImplStageId` 分支（撞门前预防）。
- 测试 `test/forward-slice-import.test.ts` +2 用例；forward-slice 套件 7/7。
- 回归：核心全量 940 测试 / 9 失败，经 `git stash` 对比确认 9 个为**预存失败**（干净检出同样 9 个），本次**零新增失败**；根 vitest 195/195。

## ✅ T6 strict-green 达成（非对称配置 + forward-slice 修复）

- 配置：`LLM_MODEL=deepseek-v4-flash` + `LLM_MODEL_TEST_WRITE=deepseek-v4-pro`（叶子 flash、decision/test-write/integration → pro）+ forward-slice 预防修复后的引擎。
- 结果：`✓ live-t6-deterministic-platform`，**49 stages，26 次 LLM 调用**（in 94401 / out 77402 tok），~13.3 分钟，`summary: 1/1 passed`，**`strict delivery: 1/1`**，exit 0。
- 意义：
  1. forward-slice 第二阻碍**已清除**（预防前移到初始 impl 生效）。
  2. **难度路由的省钱配置可达 strict-green**——便宜模型做多数切片、强模型只管决策/集成即可，无需全 pro。三次 T6 对照：flash 全程→decide 失败；pro 全程→forward-slice 失败；**flash+pro 非对称+修复→strict pass**。

## ⚠️ 产物核验：strict-green 是「空心绿」（重要修正）

对上述 T6 strict pass 的产物工作区做独立真实运行核验，结论：**产物不是合格软件**，详见 [ADR-0008](adr/0008-strict-gate-gaps-integration-smoke.md)。

核验证据（真实运行）：
- `pytest` 91 passed（全绿）；`python main.py`（venv）exit 0，但交付的 `summary.json` 全为 0（无意义）。
- 真 `TaskStore` + 真 `import_tasks_from_csv` 喂一条合法行 → `TypeError: add() got an unexpected keyword argument 'status'`（核心导入功能崩溃）。
- `tasks.csv` 是 T4 期货 K 线数据（fixture 污染），无 `title` 列 → 全部行判非法跳过（也因此 main 未触发上面的 TypeError）。

缺口：① 测试在协作者边界 mock（`MagicMock` store + `patch` 生产函数）→ 假绿；② 无真实集成冒烟；③ fixture 与任务字段不匹配未检；④ main 宽 `except` 吞错；⑤ 为过导出契约塞占位符（`skipped=0`、`PermissionError=PermissionError`）。

**因此修正**：上文「省钱非对称配置可达 strict-green」需附注——它过的是**存在上述缺口的 strict 门**；按 ADR-0008 补强（真实集成冒烟门 + 协作者 mock 假绿检测 + fixture 一致性门）后需复验。这也说明：**便宜模型 + 弱门 = 看似绿、实不可交付**，门的强度比模型档位更决定产物质量。

## Skills 对齐评估 → ADR-0009

对 [mattpocock/skills](https://github.com/mattpocock/skills) 的战略审视结论（详见 [ADR-0009](adr/0009-skills-alignment-values-correction.md)）：

- **无独立 smoke skill**；集成式测试、禁止 mock 内部协作者属于 `tdd` skill 本体 → ADR-0008 三门是在补回这条被丢的原则。
- Stagent **广引 skills 概念**，但只内化了 red-green 机械，丢了 `tdd` 第一原则与 `improve-codebase-architecture` 周期步 → T6 空心绿是预言性失败。
- **不必重建流程**；需价值观校正：tdd 完整原则（门 + prompt）+ 架构深化循环 + 三级人在环检查点。

## 待验证 / 下一步
- **非对称成本配置**：`LLM_MODEL=deepseek-v4-flash` + `LLM_MODEL_TEST_WRITE=deepseek-v4-pro`（已写入 `.env.local`）→ 待第二阻碍缓解后再跑，验证「叶子 flash、decide/集成 pro」既省又能过（否则大概率同样卡在 forward-slice import）。
- 落地 [ADR-0006](adr/0006-difficulty-aware-model-routing.md) per-role env 解耦（让「只升级 decide」成为最省配置）。
- 落地 [ADR-0005](adr/0005-node-ts-language-adapter.md)：`nodeTestQualityAdapter` + seam 接入 + Node 栈引导 + Node 确定性 tier（T6n）。
- 落地 [ADR-0009](adr/0009-skills-alignment-values-correction.md)：tdd 预防 prompt、`horizontal-tdd` T4+ 升 hard、交付前架构扫、L3 交付确认。
