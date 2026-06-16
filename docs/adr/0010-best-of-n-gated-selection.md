# ADR-0010: best-of-N 门控择优（高方差切片的稳定性杠杆）

## 状态

Proposed — 2026-06-15

## 背景

T6（确定性多切片平台）经 ADR-0007/0008/0009 + 子任务 1b/1c/1d 治理后，单次 strict-pass 已从 0 升到 ~40-50%（见 `live-findings-2026-06-15.md`）。残留失败**以 LLM 生成的 run 间方差为主**（如 test_run 经 fix 链仍偶发红、decide 内容完整性），单纯继续定向修边际递减。

子任务 3a（PR #23）已交付**纯函数择优核** `best-of-n/selectBestCandidate(CandidateOutcome[])`：按 `passed → smokePassed → qualityScore → testsFailed → gateViolations → testsPassed` 排序选最优通过候选，全失败则报告无胜者。该核与执行器解耦。

本 ADR（子任务 3b）确立把择优核**接进执行器**的决策与边界。

## 决策

### 1. 择优不替代门（核心原则）

best-of-N 是「对高方差切片多采样后选最可能可交付的候选」，**不降低任何验收标准**：
- 对启用的切片跑 N 次候选，各候选经既有 **post-stage Strict-QA**（module-contract / export-contract / test-quality 等门 + `OutputQualityScorer`）映射为 `CandidateOutcome`；`selectBestCandidate` 选优后**落定胜者**。
- 胜者随后仍走**完整既有门链**（post-stage 门强制重试/失败、test_run、smoke、`blockDeliveryOnTestFailure`）。best-of-N 只是把「单次生成」换成「N 次取最优」，门一道不少。
- **全候选静态 Strict-QA 均不过** → `anyPassed=false`，回退到排名最优劣者并走既有门重试/失败路径，**绝不伪绿**（不得把「N 选 1」变成放宽验收）。

### 2. 接线点与范围（控成本）

- 接线在 LLM 阶段执行 `runLlmTextStage`（`stage-runners/`）：`bestOfNCountForStage > 1` 时走 `invokeBestOfNStageText`（跑 N 候选 + 评分 + 选优），否则保持既有单次行为。
- 默认**关**（`execution.bestOfN.enabled`，strict-true）；N 默认 3（`execution.bestOfN.count`，1..8）。
- 仅对**方差大的切片角色**启用：默认 `impl` / `test_write`（`execution.bestOfN.roles`）。`decide` 另有内容 lint 且全量 N× 成本高，默认不开。排除 bundle-write / fix / stub / replan / patch / decision 等派生或特殊阶段，避免多文件隔离复杂度与不必要的 N×。

### 3. 候选隔离

单产物切片用**时间序隔离**：候选 i 落盘→即时 `scoreCandidateStrictQa` 评分并捕获 `CandidateOutcome`→候选 i+1 覆盖前其结果已固化；最终重落胜者。post-stage Strict-QA 门为只读评估（不写盘、不记 retry 状态），故逐候选评分无副作用。多文件 bundle 切片不在范围内（见决策 2 排除）。

### 4. CandidateOutcome 映射（本阶段口径）

本阶段候选评分用**静态 Strict-QA**：`passed = (post-stage 门无 block)`、`gateViolations = block 数`、`qualityScore = OutputQualityScorer.overall`。`test_run` / `smoke` 是后续独立阶段，由胜者在下游照常经历（逐候选跑 pytest 需逐候选隔离 venv，成本高，列为后续重切片）。即本阶段 best-of-N 选「最可能过下游门」的候选，下游门仍是最终裁决。

## 验证

- 单测：`best-of-n-stage.test.ts`（config 默认/覆盖、角色门控、`runBestOfNCandidates` 选优/全失败回退/N=1 等价）；3a `best-of-n.test.ts` 不变。
- live：`STAGENT_BEST_OF_N=3 feedback:live:t6:batch`（N_runs=5）对比开关前/后 strict-pass 率与 token 成本，记入 findings。

## 后果

- **正向**：用 N× 采样把高方差切片的单次可靠性拉高；与门正交（不改验收）。接线正确、安全（默认关）、单测通过、live 生效。
- **取舍**：启用切片 token/时延 ~N×；故默认关 + 仅高方差角色 + 控 N。
- **关联**：ADR-0008（门不放宽，命门）、ADR-0009（Strict-QA 门作为候选评分源）、ADR-0006（难度路由，可与 best-of-N 叠加：强模型 + 多采样）。

## live 验证结果（2026-06-15，负面结果·重要）

`STAGENT_BEST_OF_N=3 feedback:live:t6:batch` N_runs=5（详见 `live-findings-2026-06-15.md` sub-task 3b、`artifacts/t6_best_of_n.log`）：

- strict-pass **1/5（20%）vs 1d 2/5（40%）**（在 run 间方差内），但 token **~3.4×**（860k/640k vs 250k/180k）、时长 **~3.3×**（~1384s vs ~424s/run）。
- **未提升 T6**。根因：① T6 残留以 **test_run 红**为主，而本阶段候选评分用**静态 post-stage 门（不含 test 执行结果）** → 选「静态最优」≠「test 真过」；② 其余残留是 **decide 阶段问题**（内容 lint、契约欠声明），不在 impl/test_write best-of-N 覆盖内。

**修正决策**：静态-QA、impl/test_write 的 best-of-N **默认保持关**（成本 ~3× 无收益）。要见效必须换**评分信号/作用切片**：

- A. **逐候选 test_run/smoke 评分**（重切片，需逐候选工作区/venv 隔离）——直接压 test_run 红方差，是最可能见效的方向。
- B. **decide 角色 best-of-N**（按决策内容 lint / 契约完整性评分）——压 decide 内容 lint / 契约欠声明方差。

本 PR 交付的是**正确、可复用、可配置的接线骨架 + 纯择优核**；评分信号升级（A/B）为后续切片。
