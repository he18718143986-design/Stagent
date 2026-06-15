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
| 1 | T6 真实可交付收口（smoke 做成工作流内阶段 + 接 fix/replan 回路） | P0 | 方案 A（重 live） | `cursor/t6-smoke-stage-3713` | 待启动 | — |
| 2 | per-role 模型路由 env 解耦（ADR-0006） | — | — | — | ✅ **已完成（无需做）** | 已在主干 |
| 3 | best-of-N + 门控择优（难切片便宜模型并行采样，按 Strict QA 择优） | P1 | 方案 A | `cursor/best-of-n-gate-select-3713` | 阻塞中（依赖 #1 的可靠门） | — |
| 4 | 对抗式审查（异族/更强模型独立挑错回喂；**加分项，不替代确定性门**） | P2 | 方案 A | `cursor/adversarial-review-3713` | 排后（依赖 #1/#3） | — |

> 优先级依据见 `docs/live-findings-2026-06-15.md` 与 ADR-0006/0007/0008/0009：**门的强度比模型档位更决定产物质量**；无外部验证器的自我批判会"假性收敛"（业界自我纠正研究一致结论），故评审循环必须绑定可执行验证器。

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

### 待指挥会话定夺的「方案 B」候选（均为真实、隔离项）

| 候选 | 性质 | 风险/说明 |
|------|------|-----------|
| 缺失 `package.nls.json` 导致 `missing l10n key` 告警 | 结构性 | 该 catalog 文件**全仓缺失**（非 gitignore、未跟踪），`uiStrings.ts` 从 `packages/stagent-core/package.nls.json` 读取失败 → 所有 l10n key 回退原样。**根因是整份 catalog 缺失**（疑似 CI 嵌套布局下才存在），非"补几个 key"，需先调研是否由构建生成，**暂不轻改**。 |
| ADR-0005 Node/TS 适配接缝 | 中等、可 mock | 复用 `LanguageTestQualityAdapter` 抽象，加 node 对偶；范围较大，建议拆小切片。 |

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
