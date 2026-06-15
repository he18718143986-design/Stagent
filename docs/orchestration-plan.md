# 编排协调看板（SSOT）— Stagent「真实可交付」治理

> 本文件是**多会话协作的单一事实源（SSOT）**。决策/规格/评审会话维护本表；
> 实现会话各自在 `cursor/<name>-3713` 分支上动手并提 PR，完成后把 **分支名 / PR 链接 / 真实运行核验证据** 回填到本表。
> 会话之间没有实时通道——一切同步都经由本文件 + 各 PR 的 diff。

## 运作模式（已确认）

- **决策/规格/评审**：始终在「指挥会话」（本会话）进行。
- **方案 A（独立 Cloud Agent 会话）**：重 live、长跑、烧 token 的实现（如 T6 真实可交付收口）。由人把"子任务 prompt"粘到新会话启动；该会话各自 `npm install && npm run build:core`，live 需 `DEEPSEEK_API_KEY`（在 Cursor Dashboard → Secrets 配置，持久注入每个新 VM）。
- **方案 B（指挥会话内的 worktree 子代理）**：轻量、可隔离、可 mock 验证、不必烧 live token 的小改，由指挥会话用 worktree 隔离子代理直接做。

## 防并行互踩纪律

- 按**不相交的文件/模块面**切分；引擎 `exports`/`behaviorSpec` SSOT 契约即边界。
- 有依赖的**串行**；只对真正不相交的并行。
- 合并前 `git merge-tree` 预检；避免多分支同改热点文件（`deliveryWrapupStage.ts`、`Rule20Verify.ts`、`applySoftwarePipeline.ts`）。

## 验收硬标准（所有子任务通用）

1. **产物独立真实运行非平凡**：跑 `.venv/bin/python <entry>`（或 `npm test`），断言产出非平凡——**门绿 ≠ 可交付**（ADR-0008「空心绿」教训）。
2. **批量取成功率**：live 用 `--repeat N`（N≥3），结论按**成功率趋势**表述，不用单次下定论（LLM 方差）。
3. **零新增回归**：核心全量 `node --test packages/stagent-core/dist/test/*.test.js`（先 `npm run build:core`）保持「与基线一致」——基线有 **9 个既有失败**（见 `docs/live-findings-2026-06-15.md`），勿误判为回归；根 `vitest`（`npm test`）保持全绿。
4. **不提交**：任何密钥、`artifacts/`、`examples/test1/` 等生成产物。
5. 不碰 Electron GUI（云端无显示器）；只动 headless / 引擎 / 测试 / 文档。

---

## 子任务看板

| # | 子任务 | 优先级 | 跑法 | 分支 | 状态 | PR |
|---|--------|--------|------|------|------|----|
| 1 | T6 真实可交付收口（smoke 做成工作流内阶段 + 接 fix/replan 回路 = A1） | P0 | 方案 A（重 live） | `cursor/t6-real-deliverable-governance-dac2` | ✅ **A1 已交付+验证**（PR #11）；但 T6 端到端仍 0/4，被独立的 decide 契约污染挡在 smoke 之前 → 拆出 #1b | #11 |
| 1b | decide 契约污染修复（`decide_pipeline` 把跨切片符号塞进 `pipeline.exports` → 误导 impl 写跨切片 import → module-contract 门判红） | P0 | 方案 A（重 live） | `cursor/t6-decide-contract-pollution-dac2` | ✅ **已根治+真实运行证明**（PR #14）：store/pipeline 切片真过、`import pipeline` 不再 ImportError。核心 984/9 零新增、headless 25/25、vitest 204。T6 仍 0/3，但阻断**前移到独立问题** ①②③（见下） | #14 |
| 1c | **test-slice-import 门 order-aware 调和**（②） | P0 | 方案 A（重 live） | `cursor/test-slice-import-reconcile-dac2` | ✅ **达成**（PR #20）：order-aware 放行前序真实协作者、仍拦 __init__/前向/未声明（L101+L174 两处）。**T6 真正抵达并通过 A1 smoke、workflow 完成、产物真实非平凡**（`python main.py → {"imported":3,...}`）。核心 1050/9 零新增、headless 30/30、vitest 204 | #20 |
| 1d | **残留 bug 定向修 + 测试生成 prompt 加固**（快赢） | P0 | 方案 A（重 live） | `cursor/t6-residual-fixes-dac2` | ✅ **达成**（PR #22）：(a) 协作者 import 来源纪律 (b) status 透传 + smoke status 保真断言 (c) test_main tmp 隔离 (d) materialize_stub_main 引擎修。**T6 strict-pass 0/3 → 有效 2/4（~50%），两次均产物真实运行 + status 语义核验**。核心 1059/9 零新增、headless 30/30、vitest 240。剩余=生成方差 + ① | #22 |
| 2 | per-role 模型路由 env 解耦（ADR-0006） | — | — | — | ✅ **已完成（无需做）** | 已在主干 |
| 3a | best-of-N **选择策略纯函数核**（无 token） | P1 | 方案 B | `cursor/best-of-n-selection-core-3713` | ✅ **完成（待合并）** PR #23：`selectBestCandidate`（按 Strict QA 择优，纯函数永不抛）；新测 14/14、核心 9 零新增、vitest 243 | #23 |
| 3b | best-of-N **执行器接线 + T6 验证**（难切片跑 N 次采样 → `selectBestCandidate` 择优；压方差到稳定 strict-pass） | P1 | 方案 A（重 live，**N× token**，余额已恢复） | 待启动（基于 #23 合并后 / 其分支） | 待启动 | — |
| 4 | 对抗式审查（异族/更强模型独立挑错回喂；**加分项，不替代确定性门**） | P2 | 方案 A | `cursor/adversarial-review-3713` | 排后（依赖 #1/#3） | — |

> 优先级依据见 `docs/live-findings-2026-06-15.md` 与 ADR-0006/0007/0008/0009：**门的强度比模型档位更决定产物质量**；无外部验证器的自我批判会"假性收敛"（业界自我纠正研究一致结论），故评审循环必须绑定可执行验证器。

**协作备注**：
- 本看板目前只在 PR #12 分支（未并入 main），故 off-main 的实现会话**看不到也无法回填**——状态由实现会话**报告给指挥会话代填**，或先把本文件并入 main。
- 分支后缀按各会话自身策略（如 `-dac2` / `-3713`），不必统一；以 PR 链接为准对账。

**T6 strict-pass 阻断链进展（1c 后，2026-06-15）**：
- **② test-slice-import 门** → ✅ **已调和（1c/PR #20）**，T6 抵达并通过 A1 smoke、产物真实非平凡。
- **③ pipeline priority 类型集成 bug** → 本 batch 未出现（run#1 真实导入成功，A1 smoke 域内已被覆盖）。
- **① decide I-17/I-18** → 本 batch 0 次（未阻断）；仍为潜在 decide 质量轨。
- **新的主阻断（残留）= 测试生成 run 间方差**：run#2 stub-main 验证 exit 1、run#3 模型误写 `from main import TaskStore`（被门**正确**拦）+ post-strict `test_main` 隔离 bug + **status 透传语义 bug**（超出 smoke 非平凡判据）。
  - → **这是 LLM 生成方差，正是子任务 3（best-of-N + 门控择优）的对症场景**（现已解锁：门/smoke 可靠）。另含 2 个可定向修的具体 bug（status 透传 / test_main 隔离）。

**1d 后（2026-06-15 晚）**：(a)~(d) 已修，T6 strict-pass **0/3 → 有效 2/4（~50%，真实+status 核验）**。剩余两类（均深层、独立）：
- **生成方差**（run#2 test_run 经 fix 链仍红、blockDeliveryOnTestFailure 正确拦；run 间生成不稳）→ **子任务 3 best-of-N**（系统解，对症方差）。
- **① decide 内容 lint I-17/I-18**（run#3）→ 独立 decide 内容完整性轨。

> ✅ **API 余额已恢复**（2026-06-15 晚）：live/方案 A 工作可继续。best-of-N 选择核（3a）已无 token 完成（PR #23）；下一步 3b 执行器接线 + T6 验证（方案 A，N× token）。

---

## 核查发现（指挥会话，2026-06-15）

### 子任务 2（ADR-0006 per-role 解耦）= 已全部落地，无代码可做

经读源码 + 跑测试确认：

- 解析：`scripts/headless/lib/llm-config.mjs` `parseRoleModels` / `buildLlmConfig` 已支持 `LLM_MODEL_DECISION` / `LLM_MODEL_TEST_WRITE` / `LLM_MODEL_INTEGRATION` 独立 env（含各自 `*_BASE_URL` / `*_API_KEY` 与 test-write 历史别名）。
- 接线：`buildRoleModelRouting` → `roleOverrides` / `llmExtraModels`（按 family 去重）/ `roleUsageLabels`；`scripts/headless/run.mjs` L616-635 已消费并注入平台。
- 语义：`LLM_MODEL_TEST_WRITE` 已改为**只路由 test-write**（不再连带 decision/integration），与 ADR-0006 §3 一致。
- §4 分角色成本：`scripts/headless/lib/llm-usage.mjs` `summary().byRole` + `formatUsageLine` 已输出，`run.mjs` 报告含 `llmUsage`。
- 文档：`.env.example`、`examples/nanhua-futures-mvp/README.md` 均已记录推荐非对称配置。
- 测试：`node --test scripts/headless/lib/llm-config.test.mjs` → **7/7 通过**。

→ 故本会话**未**为子任务 2 启动 worktree 子代理（避免重复造轮子）。`docs/live-findings-2026-06-15.md` L101「落地 ADR-0006 per-role env 解耦」可视为**已完成**。

### 「方案 B」已完成项（worktree 子代理 + 指挥会话验证）

| 项 | 状态 | PR | 说明 |
|----|------|----|------|
| `missing l10n key: stagent.planCompleteness.*` 告警 | ✅ 完成（已合并 main） | #13 / `cursor/l10n-plan-completeness-nls-3713` | 调研确认 `package.nls.json` 全仓缺失且从未提交。**只补 planCompleteness 命名空间**（增量）：新增该 catalog（21 key）+ 修复 `lintMsg.ts` fallback **丢弃 `...args`** 的潜在 bug（经 worktree 子代理验证时发现）。验证：新测 2/2、核心套件 9 失败零新增、根 vitest 204/204。 |
| mvp-acceptance 支持 Node/TS（`requireDirTs`，T6n 前置） | ✅ 完成（待合并） | #15 / `cursor/mvp-acceptance-node-lang-3713` | `mvp-acceptance.mjs` 加 `dirHasTs`/`requireDirTs`/node 语言模式（config.json、ts 主入口/测试、跳过 pytest），Python 默认零变化。worktree 子代理实现 + 指挥会话独立复跑：headless **30/30**、mock feedback **6/6**。与 1b 文件面零重叠（headless vs 引擎）。 |

### 「方案 B」候选 — 核查后更新（2026-06-15）

| 候选 | 现状（已核查） | 结论 |
|------|----------------|------|
| ADR-0005 Node/TS 适配（"最小切片"） | **PR-1/2/3 已落地** + **mvp-acceptance node 模式 = PR #15**（见上表）。 | 剩余开口：**PR-4（Node 栈引导：npm install + tsc --noEmit + vitest run 作 test_run）→ PR-5（T6n live tier，附录 B：tier 配置 + 运行验证）→ PR-6（zip）**。这些需 **live 跑**或碰 disk-bootstrap/PR #11 文件 → 属**方案 A**，建议 **1b 之后**再做（复用 smoke 门、避免碰撞）。mvp-acceptance node 模式只验测试文件存在；node 测试**通过**由工作流 `test_run`(vitest)+smoke 保证，T6n PR 可视需补 vitest 执行。 |
| 其余 l10n 命名空间 catalog | 多为**动态拼接 key**，只能覆盖部分；且 `package.nls.json` 仍在未合并的 **PR #13**。 | 低价值 + 需叠在 PR #13 上（PR 依赖链）。**暂不做**。 |

> 经核查：两个原候选要么已完成（ADR-0005 PR-1/2/3），要么低价值（l10n 其余命名空间）。当前**没有**高价值且"轻量/可隔离/可 mock/不烧 token"的方案 B 任务；不制造并行 busywork。Node/TS 推进应作为 **1b 之后的方案 A 子任务**（PR-4 栈引导 → PR-5 T6n live 验证）。

---

## 子任务 1 · 可直接粘贴 prompt（T6 真实可交付收口）

> 用法：在 Cursor 新建一个 Cloud Agent 会话，把下面整段（代码块内）粘贴为任务。需在该会话 Secrets 配 `DEEPSEEK_API_KEY`。

```text
# 任务：让 Stagent T6 真正「strict pass = 真实可交付」（非空心绿）

## 背景
本仓库（@stagent/core 工作流引擎 + headless 评测）正在治理「空心绿」：strict 门全绿
≠ 产物可交付。最后一道阻断：LLM 偶尔不写 if __name__ / 不建输出目录 → main 空转。
当前真实集成冒烟只存在于 strict 验收阶段（scripts/headless/lib/mvp-acceptance.mjs），
它能诚实判红，但**是事后门、无 fix 回路**，所以「main 跑不起来」无法被自动修复。
依据：docs/adr/0008-strict-gate-gaps-integration-smoke.md、docs/live-findings-2026-06-15.md。

## 目标（首选 A1，根治）
把「真实集成冒烟」做成**工作流内阶段**，失败走既有 fix/replan 回路，使
「main 空转 / 跑不起来」可被自动修复：
1. 评估现有 packages/stagent-core/src/disk-bootstrap/smokeStage.ts 当前行为
   （是否真的跑主入口 + 断言产出非平凡），与 A1 目标的差距。
2. 在 deliveryWrapup 之前注入/强化 smoke 阶段：跑主入口（.venv/bin/python <entry>），
   断言 stdout/产出文件非平凡（非空、非全 0、非占位）。
3. smoke 失败时进入既有 fix 链（参考 runtime-replan/ 的 fix-exhausted 路由、
   quality-gates/preStageGates.ts 的 GATE_ID_SMOKE_DATA_BOOTSTRAP、
   stage-runners/prelude/runStagePrelude.ts 的 delivery-block 逻辑），
   修复后 rewind 重跑，预算耗尽再 hard fail（对齐 blockDeliveryOnTestFailure）。
关键文件：disk-bootstrap/{smokeStage,smokeDataBootstrap,deliveryWrapupStage,applySoftwarePipeline}.ts、
runtime-replan/、execution/DeliveryBlockOnTestFailure.ts、test/smoke-stage.test.ts（扩测）。
（兜底 A2：仅强化 impl/test-write 预防文案 + 复跑——但无外部验证闭环，仅作 fallback。）

## 验证（必须）
- 先 npm install && npm run build:core；mock 基线 npm run feedback 应全过。
- 单测：每改一处先跑
    node --test packages/stagent-core/dist/test/*.test.js   （先 build:core）
    node --test scripts/headless/lib/*.test.mjs
  核心保持「与基线一致、零新增失败」（基线 9 个既有失败，勿误判回归）；根 npm test 全绿。
- live：先 npm run feedback:live:t1 确认 key/网络；再 npm run feedback:live:t6:batch（N=3）。
- **产物独立真实运行核验**（防空心绿）：进 --keep 保留的工作区，跑 .venv/bin/python <entry>，
  断言产出非平凡；记录真实 strict-pass 成功率到 docs/live-findings-*.md。
- 回归：确认既有 strict 任务仍通过（无回归）。

## 硬性约束
- 不提交密钥 / artifacts/ / examples/test1/；不碰 Electron GUI（云端无显示器）。
- 只动 headless / 引擎 / 测试 / 文档；改门禁前先读 docs/STAGENT-PRD*.md + docs/adr/。
- 分支用 cursor/t6-smoke-stage-3713；commit/push 后开 PR，标题概述「T6 真实可交付收口」，
  正文列：做了什么、A1/A2 选择与理由、T6 成功率数据、回归结果、更新的 ADR/findings，
  并附最终一次 T6 的 summary 段 + 产物核验证据（python <entry> 的真实产出）。
- 完成后把分支名 / PR 链接回填到 docs/orchestration-plan.md 的子任务看板。
```

## 子任务 1b · 可直接粘贴 prompt（decide 契约污染修复，接续 A1/PR #11）

> 用法：在已跑过 A1 的同一会话里继续（它已有 A1 上下文），或在新会话粘贴本段。需配 `DEEPSEEK_API_KEY`。

```text
# 任务：修复 T6 的 decide 契约污染，让 T6 真正 strict pass（新子任务，接续 A1/PR #11）

## 背景（接续）
你已交付 A1（PR #11）：真实集成冒烟做成工作流内 smoke 阶段 + 接 fix/replan 回路，
单测/mock/T1 全过、A1 确定性产物核验通过。但 T6 端到端连跑 0/4，失败均在 smoke 之前，
根因是一个独立于 A1 的 decide 契约污染回归：
- decide_pipeline 把跨切片符号（store 的 add/update/list_all、模块名 store/statemachine、
  占位 DictReader）塞进 pipeline.exports；
- 这误导 impl 写出顶层跨切片 import（from . import store）→ 真实 ImportError；
- module-contract 门（python-forward-slice-import 家族）正确判红；
- flash 与 pro 同样命中 → 确定性 decide 契约质量回归，非模型档位、非 A1 范围。
本任务作为【新子任务 1b / 新分支 / 新 PR】，不要改动或扩大 PR #11。

## 分支策略
基于 A1 分支（cursor/t6-real-deliverable-governance-dac2）新建本任务分支（或在 PR #11
合并后基于 main），确保验证 T6 端到端时 A1 的 smoke 阶段在场。分支后缀沿用你会话策略。

## 步骤
1. 证据先行（别凭代码猜根因）：从 --keep 的 T6 工作区导出 decide_pipeline 的真实输出，
   确认 pipeline.exports 到底混入了哪些跨切片符号/模块名/占位，把样本贴进 PR/findings。
   若根因不是 100% 确定，用 Debug 子代理做一轮假设验证。
2. 先写确定性复现（mock 可验、不烧 token）：单测喂一份"被污染的 decide 契约"
   （pipeline.exports 含跨切片符号/模块名/占位），断言净化/lint 能剥离或硬拦并给出清晰报错。
   相关文件：commitment/sliceContractExports.ts、python-contract/ModuleContractLint.ts、
   python-contract/PythonExportContractLint.ts、python-contract/ForwardSliceImportLint.ts、
   python-contract/sliceContractGateHelpers.ts、plan-completeness/moduleContractChecks.ts。
3. 实施 prevention-at-decide（组合，别只靠 prompt）：
   - 选项1（decide 提示）：明确"模块 exports 只能是本切片自身的公开符号，不得列其它切片
     符号/模块名/占位（如 DictReader）"。
   - 选项2（确定性契约净化/lint）= 主力：对 decide 产出的 pipeline.exports 做确定性剥离/
     硬拦跨切片符号、模块名、占位（纯 prompt 受 LLM 方差影响，"门强 > 模型档"，必须确定性兜底）。
   - 禁止用选项3（放宽 module-contract 豁免）作为主修法：那门正确判红了真会 ImportError 的
     pipeline，放宽 = 重造"空心绿"（ADR-0008）。仅当运行时证据证明确属误报才考虑，且收窄、
     不得把豁免从 main-only 泛化到集成切片。
4. 双重复验（别只看门绿）：
   - 单测：先 npm run build:core；node --test packages/stagent-core/dist/test/*.test.js
     保持 9 个既有失败、零新增；node --test scripts/headless/lib/*.test.mjs 全过；npm test 全绿。
   - live：跑真正的 npm run feedback:live:t6:batch（N≥3，补上之前缺的脚本运行）。
   - 产物独立真实运行核验：进 --keep 工作区跑 .venv/bin/python <entry>，断言产出非平凡。
   - 验收定义：decide 修复后 T6 能跑到 smoke、smoke 判绿、且真实运行非平凡 = 真正 strict pass。
   - 把 T6 成功率 + 真实运行证据写进 docs/live-findings-*.md。
5. 记录决策：新 ADR 或扩 ADR-0007（prevention-at-decide：module exports 契约）。

## 硬性约束
- 不提交密钥 / artifacts/ / examples/test1/；不碰 Electron GUI（云端无显示器）；
  只动 headless/引擎/测试/文档；改门禁前先读 docs/STAGENT-PRD*.md + docs/adr/。
- commit/push 后开新 PR，标题概述「T6 decide 契约污染修复（prevention-at-decide）」，正文列：
  根因证据（污染样本）、修法（选项1+2、为何不放宽门）、T6 成功率（:batch N≥3）、
  产物真实运行证据、回归结果、更新/新增的 ADR/findings。
- 完成后把【分支名 + PR 链接 + T6 成功率】回报给指挥会话（看板在 PR #12，未并入 main，
  由指挥会话代填）。
```

---

## Harness 9 维自评 + 新思路（2026-06-15）

> 完整评分表与论述见 `docs/stagent-full-flow.md` 同名节。摘要：以"好/差 Harness"9 维评估，Stagent 6/9 已达"好"（验证/状态/可改进性/工具/上下文部分/任务输入部分），缺口在 **权限 / 团队协作 / 失败处理的"沉淀规则"**。

### 新增子任务登记（本评估产出，尚不在原路线图）

| # | 子任务 | 价值 | 跑法 | 状态 | 与 1b 碰撞 |
|---|------|------|------|------|-----------|
| 2A | 每阶段**能力契约 + 写入范围**声明/强制（权限；并解锁并行隔离） | 高 | 方案 B（mock 可验） | ✅ **首切片完成（待合并）** PR #17 / `cursor/stage-capability-contract-3713`（5 新文件，dead-code-safe 无接线；新测 14/14、核心 9 失败零新增、vitest 204）。后续：给 Stage 加 capabilities 字段 + 执行前接线（file-write/code-runner 拦截 + 高风险 HITL）+ 打通并行写入隔离。 | 低（仅新增 capability/*，未碰生效路径） |
| 2B | **失败→规则沉淀闭环**（experiences/failures → 候选规则 → 影子/warn → 晋升为门） | 最高 | 方案 B（mock 可验） | ✅ **首切片完成（待合并）** PR #16 / `cursor/rule-distillation-loop-3713`（6 新文件，dead-code-safe 不硬阻断；新测 13/13、核心 9 失败零新增、vitest 204）。后续：warn→hard-block 接入生效门 + 真实遥测。 | 低（仅新增 rule-distillation/*，未碰生效路径） |
| 2C | **PR/CI-ready 输出**（交付收口产 分支+PR 描述+CI 片段+review artifact） | 中高 | 方案 B（mock 可验） | ✅ **首切片完成（待合并）** PR #19 / `cursor/pr-output-generator-3713`（4 新文件，dead-code-safe 无接线；`buildPrDescription`+`buildReviewSummary` 纯函数；新测 12/12、核心 9 失败零新增、vitest 204）。后续：交付收口接线（用 TaskBrief/DoD/qualityReport 组装）。 | 零（新 pr-output/*，不碰生效路径） |
| #4 | **结构化任务简报 schema**（goal/non-goals/boundaries/acceptance + 范围蠕变校验器） | 中 | 方案 B（mock 可验） | ✅ **首切片完成（待合并）** PR #18 / `cursor/task-brief-schema-3713`（6 新文件，dead-code-safe 无接线；新测 18/18、核心 9 失败零新增、vitest 204）。后续：接 polish/grill 填充 + 作验收单一真源 + 范围蠕变门（先 warn）。 | 零（新 task-brief/*，不碰生效路径） |

> 已合并 main：#11 A1、#13 l10n、#14 1b decide 契约修复、#15 mvp-acceptance Node、#16 2B 规则沉淀、#17 2A 能力契约、#18 #4 任务简报、#19 2C PR 输出。
> **进行中**：子任务 1c（test-slice-import 门 order-aware 调和，基于最新 main + A1 smoke）。
> **接线/生效整合（2A 接线、2B warn→block、#4 接 polish/grill、2C 接交付收口、Node PR-4）** 待 T6 真正 strict-pass 后做带 live 验证的整合。

> 优先 2B（最高杠杆：引擎越用越强）；2A 次之（安全 + 解锁并行）。两者文件面与 1b 的 `python-contract`/decide 契约**零重叠**，可并行。

## 子任务 2B · 可直接粘贴 prompt（失败→规则沉淀闭环 · 安全首切片）

> 用法：新建 Cloud Agent 会话粘贴；或本指挥会话用 worktree 子代理做。mock 可验、不烧 token。

```text
# 任务：失败→规则沉淀闭环 第一切片（候选规则 store + 提炼 + 影子/warn，不硬阻断）

## 背景
Stagent 失败处理已有「定位（DiagnosticRouter/FailurePatternAnalyzer）+ 回滚（runtime-replan rewind）」，
但「沉淀规则」只回灌 experiences.jsonl 的 few-shot，**未固化为确定性门** → 同类 bug 可能反复。
目标：建「失败模式 → 候选确定性规则 → 遥测/置信度晋升 → 注入 QualityGate」闭环（对应"好 Harness"
的 失败处理·沉淀规则 + 可改进性·feedback loop；Totem/PR-Distiller 式，已被产品验证）。
本任务作为【新子任务 2B / 新分支 / 新 PR】，与子任务 1b（decide 契约）文件面零重叠。

## 先核查（避免重复造轮子）
搜索是否已存在候选规则/学习规则/规则晋升机制（candidate-rule / learned-rule / rule-promotion /
ruleStore 等）。若已部分存在，先回报现状再决定增量。

## 范围（安全首切片，dead-code-safe，禁止硬阻断）
1. 新增 CandidateRule 类型 + store（如 `<taskWorkspace>/.stagent/candidate-rules.jsonl`）：
   { id, kind, matcher（正则或结构化）, message, sourceFindings[], serves, hits, acceptanceRate,
     status: 'needs_review' | 'active' | 'blocked' }。
2. 提炼器：从 experiences.jsonl + .wf-failures.jsonl + FailurePatternAnalyzer 输出，
   对**可被确定性检测的复发失败模式**派生候选规则（挑选当前还没有对应门的新模式；
   不要重复已有 ADR-0008 门如 collaborator-mock-only/placeholder-export）。
3. 晋升策略：needs_review→active（serves≥N 且 acceptanceRate>X，或人工 approve）；
   噪声规则→blocked（按遥测）。阈值可配置、有单测覆盖。
4. **影子/warn 模式 only**：active 候选规则只产 **warning（日志/报告）**，**绝不 hard-block**，
   直到人工/配置显式激活。保证坏规则零阻断风险（呼应 ADR-0008：门要强，但新规则先观察）。
5. 在 QualityGate 注册表只加一个**接缝/挂钩**（供未来激活），本切片**不接入硬门**。
   相关文件：WorkflowExperienceStore、FailurePatternAnalyzer、QualityGateIds/BuiltinQualityGates、
   新增 candidate-rule 模块。

## 验证（必须）
- 先 npm run build:core；node --test packages/stagent-core/dist/test/*.test.js 保持
  9 个既有失败、零新增；根 npm test 全绿。
- 新增单测（mock fixture，不烧 token）：从 fixture experiences/failures 提炼出候选规则；
  晋升阈值（needs_review→active / →blocked）；**影子模式断言：active 规则只 warn、绝不 hard-block**。
- 不跑 live（本切片纯确定性可验）。

## 硬性约束
- 不提交密钥 / artifacts/ / examples/test1/；不碰 Electron GUI；只动引擎/测试/文档；
  改门禁前先读 docs/STAGENT-PRD*.md + docs/adr/。
- 分支用 cursor/rule-distillation-loop-<suffix>；commit/push 后开 PR，标题概述
  「失败→规则沉淀闭环（首切片·影子模式）」，正文列：做了什么、提炼/晋升策略、为何影子不阻断、
  验证结果（单测计数、核心 9 失败零新增）、新增/扩展的 ADR（建议新 ADR 或扩 ADR-0008/0009）。
- 完成后把【分支名 + PR 链接】回报给指挥会话回填看板。

## 后续（不在本切片）
- 把 active 规则从 warn 升级为 hard-block（人工/置信度门控）；接入生效路径；
  规则效果遥测看板。
```

### 备选：子任务 2A（能力契约）一句话规格

若优先做 2A：给 `Stage` 加 `capabilities`（allowedWritePaths / allowedCommands / network:false /
highRiskNeedsApproval），在 `code-runner`/`file-write` 执行前校验；高风险命令（rm -rf / git push /
DROP）走 HITL 审批门；单测覆盖"越界写入/高风险命令被拦"。它同时是**并行多实例 worktree 写入隔离**的前提。
