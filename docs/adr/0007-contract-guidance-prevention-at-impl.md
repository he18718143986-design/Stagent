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

## 扩展：prevention-at-**decide**（module-exports 契约净化，2026-06-15 sub-task 1b）

### 背景

A1（ADR-0008 决策 1b）落地后，T6 端到端仍 0/4，失败**均在 smoke 之前**。`--keep` 工作区核验定位为 **decide 契约质量回归**（非 A1 范围）：

- `stage_decide_pipeline` 产出的 `pipeline.exports` 被污染：混入 store 的方法名 `add/update/list_all`、其它模块名 `store/statemachine`、`pipeline` 自身名、models 的 `validate_task`、占位 `DictReader=csv.DictReader`（合法仅 `import_tasks_from_csv/summarize`）。
- 污染契约**经 SSOT `resolveModuleExports` 同时喂给 impl/test-write prompt 与 module-contract 门** → 误导 impl 写出 `from . import store` → 真实 `ImportError`，门正确判红。
- **flash 与 pro 同样命中** → 确定性回归，非模型档位、非 prompt 方差。
- 关键：**global 架构 decide 的 `pipeline` 契约是干净的**（`[import_tasks_from_csv, summarize]`）；是 per-slice decide 污染了它，而 `resolveModuleExports` 优先 slice 覆盖 global。

### 决策（把本原则从 impl 推广到 decide）

**凡 decide 产出的机读契约（首例：`decisionArtifacts.modules[].exports`）会经 SSOT 喂给下游 prompt + 门，必须在 decide 侧做确定性净化 + prompt 预防，禁止把跨切片符号/模块名/占位写进某模块契约。**

实现（组合，遵循「门强 > 模型档」）：

- **确定性净化（主力）**：`sanitizeCrossSliceContamination`（`commitment/decisionArtifactsSchema.ts`，接入 `resolveModuleExports`）——某模块 slice 契约若混入「他模块名 / 他模块声明导出 / 自身模块名」即判**污染**；污染时**优先回退 global 架构的干净 M 列表**（彻底清除方法名/占位等纯幻觉符号），无 global 兜底则**剥离**可判定污染符号。未污染契约**原样返回**（不影响 T4/T5）。单点修复覆盖 prompt 与门两侧。

### 1b 续：契约**欠声明**（与过度列举对称，sub-task 1e）

3b run#2 暴露反向偏差：slice **漏声明**真实导出（如 `decide_statemachine.exports=["InvalidTransition"]`，global 完整 `[ALLOWED_TRANSITIONS,can_transition,apply_transition,InvalidTransition]`）→ impl 正确导出全集反被 `python-impl-export-extra` 误拦。统一对账规则（`sanitizeCrossSliceContamination`）：

- **过度列举**：slice ⊇ global 且有额外项 → 回退 global。
- **欠声明**：slice ⊊ global（全部 ∈ global 且更少）→ 回退 global 完整列表。
- **全占位/噪声**：slice 净化后为空（如仅 `[DictReader]`）→ `resolveModuleExports` 落 global 兜底，不返回空契约。
- **替换式 refine**（双方各有独有符号、互不为子集）→ 保留 slice（不误伤合法细化）。
- **import 来的 stdlib/进程内建**（`DictReader/DictWriter/reader/writer`、`exit/quit/help/globals/locals/callable`）并入 export-noise——它们非模块级 API，decide 偶误列致 export-extra/missing 误拦。
- prompt（`SLICE_MODULE_CONTRACT_SUFFIX`）同步要求**完整声明、勿漏、不得少于 global**。

**边界**：本类确定性净化收敛「契约 over/under/占位」长尾，但 T6 strict-pass 率受**多样 run 间 decide/test-gen 方差**（test_run 红、`sdk-path test-import`、fixture 漏列）共同制约，单项修复率提升在方差内（见 `live-findings` 1e）。
- **decide prompt 预防**：`SLICE_MODULE_CONTRACT_SUFFIX`（`commitment/parseDecisionArtifacts.ts`）明确「exports 只能是本切片自身顶层 def/class 公开符号；禁列他切片符号 / 模块名 / 导入占位别名；他切片能力当依赖调用而非列入本切片 exports」。
- **不放宽 module-contract 门**：该门正确判红了真会 `ImportError` 的 pipeline；放宽 = 重造空心绿（ADR-0008）。未把 main-only 的 `crossSliceExports` 豁免泛化到集成切片。

### 验收

- 单测喂 T6 真实污染样本（`decision-record-exports.test.ts`、`module-contract-lint.test.ts`）：`resolveModuleExports('pipeline', 污染 slice, 干净 global)` → `[import_tasks_from_csv, summarize]`；store 类方法过度列举 → `[TaskStore]`；main `cli`↔`run` 互换；未污染/合法 refine 原样返回。核心套件零新增失败。
- live（`feedback:live:t6:batch` N=3）：**契约污染失败模式已消除**——修复前 batch 失败于 store(`add`)/pipeline(cross-slice)/main(`cli`) 契约污染；修复后这些**全部不再出现**，store/pipeline 切片真实通过（test_run 绿），`python3 -c "import pipeline"` 不再 `ImportError`。详见 `live-findings-2026-06-15.md` sub-task 1b 与 `artifacts/t6_decide_fix_verification.log`。
- **边界**：T6 端到端 strict pass 仍被**与契约污染无关**的独立问题阻断（decide 内容 lint I-17/I-18、`python-test-slice-import-module-mismatch` 门与真实协作者原则冲突、pipeline priority 类型集成 bug——后者属 A1 smoke 捕获域），列为后续治理项。
