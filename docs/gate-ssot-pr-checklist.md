# Gate / SSOT PR Checklist

> 每次新增或修改一种 gate / lint 规则时，按此清单逐项确认后方可合并。  
> 对照文档：[STAGENT-PRD-ENGINEER.md §8.1–8.3](./STAGENT-PRD-ENGINEER.md#81-根治机制框架四条原则) · [平台演进闭环 §5.8](./STAGENT-PRD.md#58-平台演进闭环-g11)

---

## 0. 关联信息

- **问题类型**（必填）：
  - [ ] 坏测试
  - [ ] 乱导包
  - [ ] 乱配置
  - [ ] 决策低质
  - [ ] smoke / CLI
  - [ ] 并发死锁（已知 gap）
  - [ ] 其他: ___
- **触发 Run#**（必填）：`#___`（须附 instance id，格式 `xxxxxxxx-xxxx-...`）
- **根因层**（必填）：
  - [ ] LLM 幻觉
  - [ ] SSOT 缺失
  - [ ] Gate 未覆盖
  - [ ] 重试无上下文

---

## 1. Gate 接线

### 1.1 Lint 与 Gate 注册

- [ ] **`XxxLint.ts`**（或 `python-contract/` 下对应 lint）— 纯函数；返回 issue 列表（`code` + `message`）；单测覆盖正反例
- [ ] **`settings/readers/exec.ts` + `execution-bindings/`**（若需三档）— `readXxxLintMode(): off | warn | hard`
- [ ] **`QualityGateIds.ts`** — 注册 gate id（`GATE_ID_XXX`）
- [ ] **`postStageGates.ts` 或 `preStageGates.ts`** — 接入对应挂载点：
  - [ ] **post-stage**：落盘后检查（如 `test_write` / `impl` / `fix`）
  - [ ] **pre-stage**：执行前检查（如 `test_run` / `smoke`）

### 1.2 引擎注册与阻断信号

- [ ] **`BuiltinQualityGates.ts` / `createWorkflowEngineParts`** — gate 已注册；headless 与 UI 共用同一 registry
- [ ] **`LlmTextScoreStep.ts`** — block 时抛出对应 `*GateBlockedError`（若适用同 stage LLM 重试）

### 1.3 同 stage 重试（按阶段类型勾选路径）

- [ ] **test_write / testfix replan** → `LlmTextScoreStep` + `LlmTextStageRunner` + `testWriteGateRetry.ts`
- [ ] **impl / fix_if_failed** → `LlmTextScoreStep` + `LlmTextStageRunner` + `mutateGateRetry.ts`
- [ ] **decide / HITL（决策低质）** → `DecisionLintGate` + harness `scripts/headless/run.mjs` `drainHitl`（`engine.retry(stageId, lint反馈)`，≤2 次）
- [ ] **pre-test_run 等** → 确认走 `gate-repair` / `tryRuntimeReplanFromGateBlock` / 快速失败，**勿误接** mutate/test_write 同 stage 重试

### 1.4 重试反馈文案（`mutateGateRetry.ts` 或 `testWriteGateRetry.ts`，按 stage 二选一）

- [ ] 具体违规位置（文件名 + 行号 / 符号名 / 配置键名）
- [ ] 正确写法示例（≥1 条可直接复制的代码片段）
- [ ] 禁止写法（≥1 条反例）
- [ ] 若违规类型为 config 契约，参考 [附录 A：config 契约文件序](#附录-aconfig-契约典型文件序)

---

## 2. SSOT 配套（如需预防同类漂移）

- [ ] **`LlmTextInvokeStep.ts`** — 在调 LLM 前注入 SSOT（`systemPrompt` 拼接点）
- [ ] **`build*BridgePromptSuffix.ts` 或 `build*PromptSuffix.ts`** — 新增或更新对应生成函数
- [ ] SSOT 数据源是 **`decisionArtifacts` / 已落盘契约文件**，不是骨架模板硬编码
- [ ] **decide 上游**：若下游 SSOT 来自 decide，确认 `DecisionLintGate` 或 harness 重试能拦住低质决策（§8.1 ②′）

---

## 3. 单元测试（`*.test.ts`）

### 3.1 Lint / Gate

- [ ] **lint 函数单测**：正例触发、合法输入不误报、边缘情况
- [ ] **gate 集成单测**（仿 `*-gate.test.ts`）：
  - [ ] `hard` 档：应 `severity: block`
  - [ ] `warn` 档：应 warn 不 block
  - [ ] `off` 档：gate 不启用或不阻断

### 3.2 重试

- [ ] gate block → 带反馈重写 → 通过（仿 `*-gate-retry.test.ts`）
- [ ] 重试次数上限：耗尽后不再同 stage 重写，进入 `failWorkflowStageFromGate` 或 harness 快速失败

### 3.3 SSOT 注入（如有）

- [ ] 契约内容变化时 prompt 相应变化
- [ ] 契约缺字段时有降级逻辑，不 crash

---

## 4. Mock 回归

- [ ] `npm run build:core` 通过
- [ ] `cd packages/stagent-core && npm test` 全绿
- [ ] `npm run feedback:quick` **6/6 通过**（接线没断）
- [ ] 若改动了 `planDeterministicReplan` 或 `applyRuntimeReplan`，须加 replan 路径单测

---

## 5. Live 验证（单 PR 合并前）

- [ ] `npm run build:core && npm run feedback:live:t4` 运行至少 **1 次**
- [ ] 结果记录（必填）：
  - instance id：`_________________________________`
  - 耗时：`___ s`
  - headless 判定：
    - [ ] **strict delivery PASS**（T4 目标）
    - [ ] FAIL @ ___（仍须记录 instance id）
    - [ ] 仅 workflowCompleted / runner-failed-accepted（**不算** T4 strict 通过，须在 PR 中注明）
  - 目标 gate 是否触发并按预期处理：`[ ] 是 [ ] 否（说明：___）`

---

## 6. 文档更新

- [ ] **`t4-live-iteration-log.md`** — 追加 Run 条目（instance、耗时、终态、修复摘要）
- [ ] **`STAGENT-PRD-ENGINEER.md §8.2`** — 对照表新增或更新对应行
- [ ] **`STAGENT-PRD.md` 附录 B** — 失败案例追溯表新增一行（现象 / 根因层 / PRD 对应）
- [ ] 若为**已知 gap**（无静态 gate 能覆盖），在 §8.2「机制」列标注 `gap: 仅 xxx 兜底`，防止误认为已有结构性防御

---

## 7. 上线后稳定性确认（里程碑 · 非单 PR 阻塞项）

> Phase 5 标准：若干根治 PR 合并后，再执行本节。

- [ ] 连续 **2 次**全新工作区 `feedback:live:t4` **strict delivery pass**
- [ ] 若未达到，在迭代日志 / issue 中记录剩余方差原因，并开 follow-up

---

## PR 作者自答 · Reviewer 核查

1. 这个改动是「写了确定性规则」还是「只调了 prompt 措辞」？若是后者，是否有对应 gate 兜底？
2. 重试反馈里，LLM 能看到违规文件的相关内容吗（文件全文 or 关键片段）？
3. 这种失败模式下次再出现，gate 会自动拦住，还是还需要人看日志？
4. 若 SSOT 来自 `decide`，decide 低质时下游会不会带着污染源继续跑？（→ 是否需 `DecisionLintGate` / harness 重试）

---

## 附录 A：config 契约典型文件序

专用于「乱配置 / main.py 发明顶层键」类改动（Run #43/#44）：

1. `ConfigContractLint.ts` — lint 纯函数（含 `buildConfigYamlAccessGuide` 等）
2. `QualityGateIds.ts` — 注册 gate id
3. `postStageGates.ts` — 接入 impl/fix post-mutate
4. `testImportBridgePromptSuffix.ts` — `buildConfigYamlBridgePromptSuffix` SSOT 注入
5. `mutateGateRetry.ts` — 重试反馈专项文案
6. `test/config-contract-*.test.ts` — 正反用例
7. `npm test` + `feedback:quick` → `feedback:live:t4` + iteration log 一行

其他问题类型见 §8.2 对照表的「仓库落点」列，不必机械套用本附录顺序。

---

*与 [STAGENT-PRD-ENGINEER.md](./STAGENT-PRD-ENGINEER.md) Engineer Review v1.3 同步。*
