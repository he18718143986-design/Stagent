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

## A1 落地：真实集成冒烟做成工作流内阶段 + fix 回路（2026-06-15，云端续作）

把真实集成冒烟从「strict 验收事后门（诚实判红但无 fix 回路）」升级为**工作流内 test_run 阶段**，复用既有自修复骨架（详见 [ADR-0008](adr/0008-strict-gate-gaps-integration-smoke.md) 决策 1b）：

- `disk-bootstrap/smokeStage.ts`：smoke 阶段改名 `stage_test_run_smoke`；oneShot 入口跑完主入口后追加 `&& node verify-smoke-output.mjs`（断言 config.yaml 声明的 JSON 产出非平凡），并注入配对 `stage_fix_if_failed_smoke`（`skipIf=exitCodeZero`）。失败经 `trySelfHealAfterTestRunFailure → fix → afterFixIfFailedStage` 回绕重跑，「main 空转/空心绿」可被**自动修复**。
- 新增 `scripts/verify-smoke-output.mjs`；`isSmokeStageId` 兼容历史 serve `stage_smoke_run`。

**A1 确定性核验（零模型变量，artifacts/a1_smoke_detection_demo.log）**：对 T6 类工作区注入引擎 smoke 命令——
- main 缺 `if __name__` → `python main.py` exit 0（旧 exit-0-only 门假绿放行），A1 判红 `产出缺失/为空：output/summary.json`；
- 产出全 0（fixture 污染/管道失效）→ A1 判红 `产出无意义（全为零/空值）`；
- 补 `if __name__: main()` + 真实数据 → exit 0、产出 `{"todo":1,"in_progress":1,...}` 非平凡。
- 路由集成单测锁定：`findFixStageForTestRun → stage_fix_if_failed_smoke`、`resolveTestRunStageIdFromFix → stage_test_run_smoke`。
- 回归：核心全量 974 pass / **9 fail（基线一致，零新增）** / 983；headless lib 25/25。

## T6 strict-pass 成功率（HEAD `719a908`，N=4，全失败且**均在 smoke 之前**）

| # | 配置 | 时长 | 失败门 | 失败切片 |
|---|---|---|---|---|
| 1 | leaves+decide=flash | 7.4min | `decisionLintRejected`（I-17 缺「AI 无法验证的假设」、I-18 边界场景<2） | `decide_pipeline` |
| 2 | leaves=flash, decide/test-write/integration=pro | 18.2min | `python-export-contract（test-import-symbol-missing）`：`test_main.py import pipeline from main` 但 main 未导出 | `main` |
| 3 | 同 #2 | 14.9min | `module-contract（python-impl-export-missing）`：`pipeline/__init__.py` 未导出契约符号 `store` | `pipeline` |
| 4 | 全 pro | 18.3min | `module-contract（python-impl-export-missing）`：`pipeline/__init__.py` 未导出契约符号 `add` | `pipeline` |

**根因（真实运行核验，决定性，非模型抖动）**：T6 当前**最后阻断已前移到 smoke 之前的 decide 契约质量**，而非「main 空转」。

- decide_pipeline 产出的 **module 契约被污染**：`pipeline.exports = [add, DictReader, import_tasks_from_csv, list_all, pipeline, statemachine, store, summarize, update, validate_task]`——把 store 的方法名（`add/update/list_all`）、其它模块名（`store/statemachine`）、models 的 `validate_task`、占位 `DictReader` 全塞进 pipeline 导出。合法 pipeline 导出仅 `import_tasks_from_csv/summarize`。
- 污染契约**反过来误导 impl**：模型据此写出 `from . import store`（把 store 当 pipeline 子模块）→ `python3 -c "import pipeline"` 抛 `ImportError: cannot import name 'store' from partially initialized module 'pipeline'（circular import）`。即 module-contract 门**正确**拦下了一个真坏掉的 pipeline——它不是误拦，**上游 decide 契约污染才是根因**。
- **flash 与 pro 同样命中**（#3 flash、#4 全 pro）→ 这是**确定性的 decide 契约质量回归**，与模型档位无关；相对 `8d09371`（findings 上文记录可达 strict-green）属回归。
- 现有 `lintImplExportsAgainstModuleContract` 的 `crossSliceExports` 豁免**仅对 `main` 切片生效**；pipeline 同为「集成下游」切片却不豁免，且 `add/update/list_all` 是 store 的**方法名**（不在任何模块 `exports`/模块名集合里），故单靠豁免泛化也无法清除。

**结论**：A1（本次交付）正确实现并已证其能根治「main 空转/空心绿」；但 T6 端到端 strict-pass 被**另一独立回归**（decide 把跨切片符号塞进 pipeline/main 契约）阻断在 smoke 之前。该回归属 decide 契约质量（prompt/schema），需 live 复跑验证，**不宜在本次（A1）改动里顺手改门以免引入更大风险**，列为下一步。

## sub-task 1b：decide 契约污染修复（prevention-at-decide，2026-06-15）

实施 [ADR-0007 扩展](adr/0007-contract-guidance-prevention-at-impl.md)（prevention-at-decide：module-exports 契约净化）。

**根因证据**（`--keep` 工作区 `stage_decide_*` 真实输出）：decide 产出的 module 契约系统性**过度列举**，三类，**均有 global 架构 decide 的干净对照**：
- 跨切片污染：`pipeline.exports` 混入 store 方法名 `add/update/list_all`、模块名 `store/statemachine`、models 的 `validate_task`、占位 `DictReader`（global pipeline=`[import_tasks_from_csv, summarize]`）。
- 类方法过度列举：`store.exports=[TaskStore, add, get, delete, update, list_all, ...]`（把 TaskStore 方法当模块级 export；global store=`[TaskStore]`）。
- main 入口同义词：slice `main=[run, TaskStore]` → 净化后落到 global `main=[cli]`，但 impl 写 `run`。

**修法**（确定性兜底 + prompt 预防；不放宽 module-contract 门）：
- `sanitizeCrossSliceContamination`（接入 `resolveModuleExports`，impl/test-write prompt 与门共用 SSOT）：① 跨切片符号/模块名/自身名污染 → 优先回退 global 干净 M 列表；② slice ⊇ global 且有额外项（superset）→ 同样回退 global（清除类方法过度列举）；未污染原样返回。
- `lintImplExportsAgainstModuleContract`：main 切片 `cli/run/main` 入口同义词互换豁免（入口确实存在、非空心绿；仍拦真缺失符号）。
- `SLICE_MODULE_CONTRACT_SUFFIX`：decide prompt 明确 exports 只能是本切片自身顶层公开符号。

**验证（成功率 + 真实运行，`artifacts/t6_decide_fix_verification.log`）**：`feedback:live:t6:batch` N=3，`LLM_MODEL=flash` + decision/test-write/integration=pro。

| 批次 | commit | strict-pass | 失败门（均与契约污染无关了） |
|---|---|---|---|
| batch1（仅 cross-slice） | `5002124` | 0/3 | store(`add`) / main(`cli`) 契约污染 + 1 test 失败 |
| batch2（+superset+同义词） | `8069cce` | 0/3 | decide 内容 lint(I-17/I-18) / test-slice-import 门 / test 失败 |

**关键结论**：**契约污染失败模式已消除**——batch1 的 store/pipeline/main 契约污染失败在 batch2 **全部不再出现**，store/pipeline 切片真实通过（test_run 绿、fix 跳过）。真实运行核验：`python3 -c "import pipeline"` 不再 `ImportError`（修复前 `from . import store` 崩溃），pipeline 正确 `import csv/import models`。

**T6 仍未 strict pass**，但阻断已**前移到与契约污染无关的独立问题**（非本 sub-task 范围）：
1. **decide 内容 lint（I-17/I-18）**：slice decide 偶发缺「### AI 无法验证的假设」节 / 边界场景<2（decide 内容完整性，pro 仍偶发）。
2. **`python-test-slice-import-module-mismatch` 门**：禁止切片测试 `from <他模块> import`（如 `test_pipeline.py` 用真实 `from store import TaskStore`）——此门与 ADR-0008/0009「用真实协作者、不 mock 内部切片」原则**直接冲突**，是下一道该治理的门。
3. **真实集成 bug**：生成的 pipeline 把 `priority` 以**字符串**传给 `validate_task`（要求 int）→ 全行跳过 → summary 全 0。此即 ADR-0008「空心绿」，**A1 工作流内 smoke 会判红并进 fix 链**——但本 run 在更早的 test-import 门即失败，未抵达 smoke。

## 待验证 / 下一步
- **【高优先·承接 1b】放宽 `python-test-slice-import-module-mismatch`**：允许切片测试 `from <他项目模块> import <该模块已声明 export>`（真实协作者，对齐 ADR-0008/0009），保留对未声明符号/不存在模块的拦截。这是 T6 抵达 smoke 的下一道门。
- **decide 内容 lint（I-17/I-18）稳定性**：slice decide 的「AI 无法验证的假设 / 边界压力测试」节完整性（decide-prompt 或 lint 阈值）。
- **非对称成本配置**：`LLM_MODEL=deepseek-v4-flash` + `LLM_MODEL_TEST_WRITE=deepseek-v4-pro`（已写入 `.env.local`）→ 待第二阻碍缓解后再跑，验证「叶子 flash、decide/集成 pro」既省又能过（否则大概率同样卡在 forward-slice import）。
- 落地 [ADR-0006](adr/0006-difficulty-aware-model-routing.md) per-role env 解耦（让「只升级 decide」成为最省配置）。
- 落地 [ADR-0005](adr/0005-node-ts-language-adapter.md)：`nodeTestQualityAdapter` + seam 接入 + Node 栈引导 + Node 确定性 tier（T6n）。
- 落地 [ADR-0009](adr/0009-skills-alignment-values-correction.md)：tdd 预防 prompt、`horizontal-tdd` T4+ 升 hard、交付前架构扫、L3 交付确认。
