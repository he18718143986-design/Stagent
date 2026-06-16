# ADR-0011：失败→规则沉淀闭环接线（提炼半 · 离线 CLI）

## 状态

Proposed

## 背景

子任务 2B 首切片（PR #16）已交付 `rule-distillation/*` 纯函数模块（提炼 / 晋升 / 影子 eval / store），但**未接线**——experiences 仍只回灌 few-shot，复发失败簇不会自动提议为候选规则。

1b~1f 手工长尾修复本质上是「人工版 2B」：定位复发模式 → 写确定性门。需要半自动桥把 experiences 聚类结果落成可审阅的候选规则台账。

## 决策

### 本片（提炼半 · 离线 CLI）

1. 新增 `runRuleDistillation.ts`：编排 `WorkflowExperienceStore` → `analyzeFailurePatterns` → `distillCandidateRules` → `promoteCandidateRules`（**不可达阈值** `minServes:9999`）→ `CandidateRuleStore.writeAll`。
2. `scripts/analyze-experiences.ts` 加 `--distill` / `--candidate-store`；不传 `--distill` 时行为零变化。
3. **安全保证**：本片不接入 `WorkflowExecutor`、不调用 `evaluateCandidateRulesShadow` 于阶段路径、不加遥测计数 → 所有新规则 `needs_review`、`serves=0` → **零 active、零 warn、零 block**。

### 诚实粒度校准

`distillCandidateRules` 的聚类粒度是 **errorType × stage 前缀**（如 `tool-execution-failed::stage_impl_x`），**非** sdk-path / fixture 漏列等细语义模式。本闭环加速「识别复发簇 + 提议候选」，**HOW 修复**仍需人判断（或后续 matcher 正则 + 门接线）。**不要声称**自动复刻 1b~1f 的手工净化。

### 第 2 片（后续，不在本片）

- `workflowCompleted` 后触发 `runRuleDistillation`（`WorkflowExecutor.ts` 单线程 / DAG 路径）。
- `evaluateCandidateRulesShadow` 接入阶段/门路径，warn-only 进 qualityReport（永不 block）。
- 遥测：`seam` 咨询 `serves++`、人工采纳更新 `acceptanceRate`，使 `promoteCandidateRules` 可真实晋升。
- 为 `distillCandidateRules` 产出补 `matcher` 正则，使影子匹配有意义。

## 后果

- 正面：离线可跑 `analyze-experiences --distill`，把 experiences 转为 `.stagent/candidate-rules.jsonl` 人审台账；与 1b~1f 手工修复形成「提议 → 人审 → 确定性门」复利路径。
- 负面：粗粒度聚类可能产生泛化建议，需人过滤噪声；自动晋升与运行时 warn 仍待第 2 片。
- 风险：本片 dead-code-safe（仅 CLI），不改变 live 工作流行为。

## 参考

- `packages/stagent-core/src/rule-distillation/`
- `docs/orchestration-plan.md` 子任务 2B
- ADR-0008（门强 > 模型档）
