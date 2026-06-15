# ADR-0009: Skills 对齐与价值观校正（tdd 完整原则 + 架构深化循环 + 人在环检查点）

## 状态

Proposed — 2026-06-15

## 背景

在 T6 产物独立核验（[ADR-0008](0008-strict-gate-gaps-integration-smoke.md)）后，进一步审视 [mattpocock/skills](https://github.com/mattpocock/skills) 与 Stagent 的关系：

### Q1：mattpocock/skills 有「冒烟」skill 吗？

**没有独立的 smoke skill。** 但「真实集成、不假绿、不 mock 内部协作者」这一原则**内嵌于 `tdd` skill**（`tdd/SKILL.md`）：

- **Good tests**：integration-style，经公共 API 走真实代码路径；描述 _what_ 而非 _how_；重构时仍应通过。
- **Bad tests**：mock 内部协作者、测私有方法、只验证调用形状；重构时挂但行为未变。
- 附属文档：`mocking.md`、`deep-modules.md`、`interface-design.md`、`tests.md`。

因此 ADR-0008 的「真实集成冒烟门 + 协作者 mock 假绿检测」**不是 mattpocock 体系之外的新发明**，而是把 `tdd` skill 被 Stagent **丢掉的核心规则**重新编码为可执行门。

### Q2：Stagent 是否正确、完整地使用了 mattpocock/skills？

**概念渗透广，但存在致命的「用了一半」。** 仓库检索显示：`tdd`、`grill`、`CONTEXT.md`、`prototype`、`to-issues`、`to-prd`、`diagnose` 等已被大量引用并**内化进引擎**（`TestQualityLint`、`SkillWorkflowAssembler`、`charter` 决策链、`Rule20Verify` 等）。`skillNative.enabled` 路径还可直接加载 `SKILL.md` 原文编排工作流。

关键缺口：

| mattpocock skill 原则 | Stagent 现状 | 缺口 |
|---|---|---|
| **tdd**：集成式测试、不 mock 内部协作者、vertical slice（tracer bullet） | 内化了 red-green 机械（`RedGreenGate`、`tdd.redGreenGate`）；`TestQualityLint` 注释引 `tdd/tests.md` | **丢了第一原则**：T6 `test_pipeline.py`（`MagicMock` store + 只断言 call shape）正是 `tdd/mocking.md` 明文禁止的反例；`horizontal-tdd` 仅 warn，未 hard block |
| **improve-codebase-architecture**：周期性架构深化、对抗烂泥球 | 仅 6 处引用，**未进自动循环** | T6「占位导出」（`skipped=0`、`PermissionError=PermissionError`）是烂泥球渗入契约博弈的信号 |
| **grill / grill-with-docs**：人在环对齐、一次一问 | `grill.adaptiveMode`、决策闸门、`charter` 覆盖 | 默认 AFK 路径可绕过；阈值升级未与 strict 验收强绑定 |
| **diagnose**：复现→最小化→假设→修复 | `fixRoutingPromptSuffix`、诊断驱动 fix | 与 prevention-at-impl（ADR-0007）互补，已部分对齐 |

### Q3：mattpocock/skills 是否适合作为 Stagent 的「核心」？要重建流程吗？

**两者设计哲学对立，但不必推倒重建：**

- mattpocock 明确主张 skills 是**小、可组合、人在环、反框架**的；专门反对 GSD/BMAD/Spec-Kit 等「接管流程、剥夺控制权」的系统。
- Stagent 恰恰是**自治治理引擎**（机读 DAG + Plan Compiler + Phase Gate + AFK 执行）——属于 mattpocock 警告的那一类。

**T6 空心绿是这套对立被忽视时的预言性失败**：agent 优化「过门」而非「可交付行为」→ pytest 全绿、main 产出全零、集成崩溃被 mock 掩盖。

**结论**：Stagent 没「用错」 skills，而是**自动化了机械、丢了判断**。结构资产（700+ 测试、门、DAG、决策闸门）应保留；需做**价值观校正**，把 skills 精髓重新注入治理，而非整体重建流程。

## 决策

确立 **Skills 对齐与价值观校正** 为 Stagent 的长期治理原则：**不替换现有引擎骨架，在门、prompt、周期步三个层面补回 mattpocock skills 被丢掉的判断。**

### 1. tdd 完整原则纳入治理（beyond red-green 机械）

把 `tdd/SKILL.md` + `mocking.md` 的完整规则编码为可执行约束，与 ADR-0008 形成闭环：

| 原则 | 治理落点 | 状态 |
|---|---|---|
| 集成式测试、走公共 API | 真实集成冒烟门（ADR-0008 决策 1）→ **升级为工作流内阶段 + fix 回路**（ADR-0008 决策 1b，A1） | ✅ 已落地：`stage_test_run_smoke`（跑主入口 + `verify-smoke-output.mjs` 断言产出非平凡）+ 配对 `stage_fix_if_failed_smoke`，「main 空转/空心绿」可被自动修复 |
| 禁止 mock 内部协作者做行为验证 | `collaborator-mock-only` 检测（ADR-0008 决策 2） | ✅ 已落地（warn；切片间集成点逐步升 hard） |
| Vertical slice（tracer bullet），禁止 horizontal | `Rule20Verify.verifyRule20` 的 `horizontal-tdd` promotion | ✅ 已落地：`verifyRule20(wf, { horizontalTddFail })` 默认 warn，T4+ strict（`tdd.horizontalTddFail`）升 violation 阻断；接线生产两调用点（`WorkflowGenerationRunner` + `reverifyRule20`） |
| 测行为不测结构 | `TestQualityLint` 现有坏味 + impl prompt 注入 `tdd` 预防指引（ADR-0007 模式） | ✅ 已落地：`deliverablePreventionSuffixes.ts` 接线 `LlmTextInvokeStep` |
| 主入口可运行 | main 切片 impl 注入 `if __name__` + 真实产出约束（预防）+ 工作流内 smoke 断言产出非平凡（兜底自修复，ADR-0008 决策 1b） | ✅ 已落地（针对本次 T6「main 空转」根因，预防 + 兜底双层） |
| 禁止占位导出 | 所有 impl 切片注入「禁止自赋值 / 无意义模块级常量」 | ✅ 已落地 |
| Fixture 与任务契约一致 | fixture 一致性门（ADR-0008 决策 3） | ✅ 已落地 |

**prompt 要求（prevention-at-impl，已实现于 `commitment/deliverablePreventionSuffixes.ts`）**：在 `test-write` / `impl` 阶段注入简短后缀，明确：

- **主入口可运行**（main impl）：必须 `if __name__ == "__main__": main()` 且真正执行业务路径、写出输出文件——直接预防本次 T6「`main()` 定义却从未被调用、`python main.py` 空转无产出」。
- **禁止占位导出**（所有 impl）：禁止 `PermissionError = PermissionError` / `null = None` 等纯过契约占位符。
- **真实协作者测试**（test-write）：切片间集成点须用真实协作者或 public API 断言行为；禁止整体 mock 内部切片后只断言 call shape（与 `collaborator-mock-only` lint 同源）。
- 每个 test→impl 对须构成 vertical slice，禁止 bulk 写完全部测试再 bulk 写 impl（`horizontal-tdd` 门，T4+ 拟升 hard）。

### 2. 架构深化循环（improve-codebase-architecture 周期步）

将 `improve-codebase-architecture` 从「偶尔引用」升级为**治理周期步**，对抗占位导出、浅模块、契约博弈式烂泥球：

- **触发时机**（满足任一）：
  - 多切片任务（T4+）在 `plan compile` 之后、`execute` 之前跑一次架构审视；
  - strict 验收通过后、交付打包之前跑一次「交付前架构扫」；
  - 检测到占位导出 / 无意义模块级常量通过 export-contract 时强制触发。
- **产出**：结构化候选清单（HTML 报告或机读 JSON），**不自动改代码**；高置信候选（`Strong`）进入 replan 或 human escalation。
- **与 ADR 联动**：候选若与现有 ADR 冲突，须显式标注「contradicts ADR-XXXX」；用户拒绝的理由可沉淀为新 ADR（同 `grill-with-docs` 纪律）。
- **首版实现（已落地）**：headless strict 验收新增 `evaluatePlaceholderExports`（`scripts/headless/lib/mvp-acceptance.mjs`），扫描工作区 `.py`（跳过 `.venv` / `__pycache__` 等）检测无歧义占位——自赋值 `X = X`、JS 风格别名 `null = None`。经 `opts.architectureScan` 开关接入，T6 tier 默认开启；与 `buildNoPlaceholderExportPreventionSuffix`（impl 预防）互为「预防 + 兜底」。完整 pass-through 模块 / HTML 报告管线为后续增量。

### 3. 人在环检查点（保留判断，AFK 为默认而非唯一）

AFK 是 Stagent 的产品形态，但**判断不能在环外永久缺席**。定义三级人在环：

| 级别 | 时机 | 行为 |
|---|---|---|
| **L1 决策闸门**（已有） | workflow 开始前 | 必须由人确认或采纳默认的决策契约（`decide` / grill） |
| **L2 阈值升级**（部分已有） | 评审打分 < 阈值 / 高风险 / 门 repeated fail | 暂停 AFK，等待人工 review（Phase Gate / Confidence） |
| **L3 交付确认**（新增，可选 strict） | strict 全绿 + 冒烟通过后 | 非技术用户 Simple Mode 屏5「下载前确认」；工程师模式可 `--yes` 跳过 |

**原则**：

- `skillNative.enabled` 与引擎内化路径**共享同一套价值观门**——不能「native skill 路径绕过 strict/smoke/mock 检测」。
- `grill.adaptiveMode` 默认关；T3+ live tier 可开，但不得削弱 L1 决策契约的结构化要求（见 ADR-0006：`decide` 用强模型）。
- 禁止把「人在环」降级为纯日志：升级须 **block workflow**，而非 warn-only。

### 4. 不做的事（明确边界）

- **不**把 mattpocock/skills 当作 Stagent 的唯一执行核心（不替换 Plan Compiler + DAG）。
- **不**要求每次 AFK run 都跑完整 `grill-with-docs → to-prd → to-issues → tdd` greenfield 序列（express 路径保留）。
- **不**新增独立 smoke skill 仓库条目；冒烟语义归属 `tdd` 治理域，由 ADR-0008 门承载。

## 验收

- **tdd 完整原则**：T6 类产物在 ADR-0008 三门 + `horizontal-tdd` hard（T4+）下不得 strict pass；`test_pipeline.py` 模式被 `collaborator-mock-only` 标记。
- **架构深化**：T6 类「占位导出」在交付前架构扫中被检出并 block 或强制 replan（至少 1 条 e2e fixture）。
- **人在环**：构造「评审低分 / 冒烟失败 / 决策 lint reject」场景，验证 workflow **暂停**而非 silent continue。
- **skillNative  parity**：同一 tier 在 `skillNative.enabled=true/false` 下 strict 验收标准一致。
- **文档**：本 ADR + `live-findings` 交叉引用；ADR-0008 标注「补回 tdd 集成原则」来源为本 ADR。

## 后果

- **正向**：把 Stagent 从「过门优化器」校正为「可交付行为优化器」；skills 对齐有明确 ADR 锚点，避免再次只内化 red-green 机械。
- **取舍**：架构深化步增加 plan→execute 延迟；`horizontal-tdd` 升 hard 可能提高 T3+ 首次通过率成本（换更真产物）。
- **关联**：[ADR-0007](0007-contract-guidance-prevention-at-impl.md)（prompt 注入模式）、[ADR-0008](0008-strict-gate-gaps-integration-smoke.md)（tdd 集成原则的门实现）、[ADR-0006](0006-difficulty-aware-model-routing.md)（decide 强模型）、UI Simple Mode 屏3/屏5（L3 交付确认）。
- **实施顺序建议**：① ADR-0008 已落地项保持 ✅ ② impl/test-write 注入 tdd 预防指引 ✅（`deliverablePreventionSuffixes.ts`） ③ 交付前架构扫 MVP ✅（`evaluatePlaceholderExports`，T6 默认开） ④ T4+ `horizontal-tdd` 升 hard ✅（`tdd.horizontalTddFail`，strict 默认开） ⑤ L3 交付确认 UI/CLI 开关（待办）。

### 生产路径说明（horizontal-tdd 双实现）

`verifyRule20` 存在两实现：生产路径用 `Rule20Verify.ts`（`WorkflowGenerationRunner` + `reverifyRule20` 均 import 它），`rule20/verify.ts` 为脚本/测试用模块化版。本次 promotion 落在**生产路径** `Rule20Verify.ts`，并通过 `GenerationGateSettings.horizontalTddFail`（可选字段，默认 undefined=warn）由 `host.readGenerationGates()` / `ctx.gates` 注入；headless `buildLiveConfigOverrides` 在 `spec.pass.strict` 块开启 `tdd.horizontalTddFail`。`rule20/verify.ts` 的同名 promotion 仍按原 `to-issues-horizontal-layering` 逻辑，未改。
