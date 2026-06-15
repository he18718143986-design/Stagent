# ADR-0007: Contract 指引前置原则（prevention-at-impl，而非只在 fix）

## 状态

Proposed — 2026-06-15

## 背景

T6 在 `LLM_MODEL=deepseek-v4-pro` 下（decide 已通过）仍 `workflowFailed`，卡在 `module-contract（python-forward-slice-import）`：生成的 `store/__init__.py` 顶层 `import statemachine`，而 store 落盘时 `statemachine/` 尚不存在。

根因分析（见 `docs/live-findings-2026-06-15.md`）：这**不是模型能力问题，而是指引时机问题**。
- 静态门 `lintForwardSliceImportsInImpl`（`python-contract/sliceContractGateHelpers.ts`，post-mutate，hard `block`）在 pytest 之前就拦截。
- 但「如何避免该违规」的指引**只在 fix 阶段、且只在 pytest 报 `No module named` 时**注入（`fixRoutingPromptSuffix` + `buildForwardSliceImportFixHints`）。
- **初始 impl 阶段从未被告知** → 模型按常规写法生成顶层 import → 一次落盘即撞 hard 门；fix 链的诊断驱动提示又因「静态门先于 pytest」而不匹配 → 反复失败直至 `workflowFailed`。

这是一类**可复用的反模式**：「post-mutate hard 门拦截某违规类，但预防指引缺席于初始 impl」。其它 contract 门（exports 契约、declared-deps、export-contract 等）可能存在同样缺口。

## 决策

确立通用原则：**凡是会在 post-mutate 以 hard 模式 block 的违规类，必须在初始 impl 的 prompt 就注入对应预防指引（prevention-at-impl）；fix 阶段的诊断驱动提示作为兜底，而非唯一来源。**

实现模式（成对）：

- 每个 contract lint 提供一对函数：
  - `buildXxxPreventionSuffix(...)` —— 供**初始 impl** 注入（无关时返回 `null`，避免噪声/token 浪费）。
  - `buildXxxFixHints(...)` —— 供 **fix/replan** 在命中诊断时注入（兜底）。
- 统一接线点：`stage-runners/LlmTextInvokeStep.ts` 的 `isImplStageId(stage.id)` 分支注入 prevention；fix 分支注入 fix hints（现状）。
- prevention 文案与门的 `message`／fix hints **同源**（同一套规则措辞），避免漂移。

### 首个落地实例（已实现）

- forward-slice：新增 `buildForwardSliceImportPreventionSuffix`（`python-contract/ForwardSliceImportLint.ts`），接线 `LlmTextInvokeStep` 的 impl 分支。测试 `test/forward-slice-import.test.ts` +2；核心套件零新增失败、根 vitest 195/195。

### 待审视迁移清单（是否也需 prevention-at-impl）

逐项核查「该门 hard block 时，初始 impl 是否已被告知如何避免」：

- `module-contract` exports（`lintImplExportsAgainstModuleContract`）：impl 是否已注入契约 exports 约束？（fix 分支已有 `contractExports` 提示）
- `python-export-contract`（`evaluateExportContractPostImplGate`）。
- `declared-deps`（`evaluateDeclaredDepsPostMutateGate`）。
- `behaviorSpec`（`buildBehaviorSpecPromptSuffix` 已在 impl 注入——可作为本原则的正面范例）。

## 验收

- 每个纳入本原则的门：构造「违规诱导」用例，验证 prevention suffix 在初始 impl 出现且文案可操作；门在 prevention 生效后不再 hard block。
- 回归：python 既有行为不变；核心套件失败数维持基线（见 findings 文档）。

## 后果

- **正向**：把「撞门→fix→再撞」的高成本循环前移为「一次写对」，对便宜模型尤其有效（少一轮 LLM 往返、少一次 strict 失败）。与 ADR-0006 难度路由叠加：decide 用强模型保证决策契约，impl 用预防指引降低叶子切片的能力要求。
- **取舍**：impl prompt 变长、token 略增——以「无关返回 null、仅相关时注入」严格控制。
- **关联**：ADR-0004（交付门禁）、ADR-0005（Node 适配，新语言的门同样遵循本原则）、ADR-0006（难度路由）。
