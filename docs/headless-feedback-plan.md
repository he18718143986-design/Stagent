# Headless 测试验证反馈计划

> 目标：在**不调 Electron UI** 的前提下，用最短反馈环验证 `@stagent/core` 架构改动是否破坏生成/执行/HITL/落盘链路。  
> 配套脚本：`scripts/headless/run.mjs` · 报告：`artifacts/headless-feedback.json`

---

## 0. Live 环境变量

```bash
cd autoAI
export DEEPSEEK_API_KEY="sk-xxxxxxxx"     # 终端本地设置，勿提交 git、勿贴进聊天
export LLM_BASE_URL="https://api.deepseek.com"   # 官网写法即可，脚本自动补 /v1
export LLM_MODEL="deepseek-chat"          # 以控制台 model id 为准
```

验证 Key（可选）：

```bash
curl -s https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"ping"}],"max_tokens":8}'
```

> 说明：引擎请求 `${base}/chat/completions`。`normalizeLlmBaseUrl` 会把 `https://api.deepseek.com` 规范为 `…/v1`，与官网文档两种写法均兼容。

---

## 1. 反馈环分层（由快到慢）

| 层级 | 命令 | 耗时 | 验证范围 | 何时跑 |
|------|------|------|----------|--------|
| **L0 构造** | `node scripts/headless/run.mjs --scenario construct` | <10ms | Engine + facade 装配 | 改 `createWorkflowEngineParts` / facade 后 |
| **L1 Mock 全环** | `npm run feedback:quick` | ~0.3s | construct → polish → generate → execute | **每次架构改动默认跑** |
| **L2 Core 单测** | `npm run feedback:unit` 或 `cd packages/stagent-core && npm test` | ~30s | 750+ 项单元/集成（精确数以命令输出为准） | 改执行器、生成器、HITL 后 |
| **L3 Live 分档** | `feedback:live` / `:t2` / `:t3` / `:t4` / `:t5` / `:all`（另有 `feedback:charter-suggest` / `feedback:charter-auto`） | 5–40min/档 | 真实 LLM，T1→T5 由简到繁；T4/T5 为 strict MVP 验收档（ADR-0004） | 调 prompt/LLM 路由/JSON 解析后 |
| **L4 回归环** | `npm run regression:loop` | ~2min | typecheck + renderer test + adapter gates | 提交前 |
| **L5 Electron 手跑** | 见 `docs/engine-parity-acceptance.md` 五项 | 人工 | UI + 真实任务形态 | 发版前 / parity 签字前 |

**日常原则：** L1 绿 → 再 L2；L2 绿 → 再 L3；L3 仅验证 LLM 相关，不替代 L2。

---

## 2. L1 Mock 四项场景 — 通过标准

| 场景 ID | 断言 | 失败时先看 |
|---------|------|------------|
| `construct` | `WorkflowEngine` 及 instances/generation/execution/hitl/artifacts 存在 | `createWorkflowEngineParts` 装配错误 |
| `polish` | 出现 `userTaskPolished`；`.wf-debug.log` 含 `[task-polish] [llm_start/end]` | mock LLM 路由 / polish prompt |
| `generate` | 出现 `workflowGenerated` 且 `blocked !== true`；`stageCount >= 3` | Rule20 / plan completeness / JSON 解析 |
| `execute` | 消息链以 `workflowCompleted` 结束；产物 `requirements.txt` `writer.py` `main.py` 存在于 workspace 或 `.stagent/instances/<key>/` | `startExecution` 未传 workflow、HITL 未自动 approve、落盘路径 |

**报告字段（`artifacts/headless-feedback.json`）：**

- `summary.passed === summary.total`
- `execute.messageTypes` 末尾含 `workflowCompleted`
- `execute.debugLogTail` 含 `[workflow] [run_end]` 且 `status":"completed"`
- `execute.llmCalls`（mock）应含 `generation` + 各 `MOCK_STAGE:*`

---

## 3. L3 Live 五档任务（简单 → 复杂）

**是的：真实案例应从简单到复杂分档**，已内置 5 档：

| 档位 | 命令 | 任务 | 验证侧重 |
|------|------|------|----------|
| **T1** | `npm run feedback:live` | 单文件 `calc.py` add 函数 | JSON 生成、最短执行链、~5min 超时（300s） |
| **T2** | `npm run feedback:live:t2` | CSV→summary.json，含润色 | polish + 多文件 prototype、DAG（~5min 超时） |
| **T3** | `npm run feedback:live:t3` | software + pytest calculator | code-runner、TDD 链、决策/HITL（~7min 超时） |
| **T4** | `npm run feedback:live:t4` | 真实多模块：南华期货自动下单（Python 5 模块） | strict MVP 验收（pytest 全绿 + MVP 目录 + traceability，ADR-0004；~40min 超时） |
| **T5** | `npm run feedback:live:t5` | T4 + charter suggest 全链 | strict MVP + Charter 链路加压（~40min 超时） |
| **全档** | `npm run feedback:live:all` | T1→T2→T3→T4→T5 顺序 | 发版前或重大架构变更 |

任务定义：`scripts/headless/lib/live-tasks.mjs`（可改 `userInput` / `taskType` / 超时）。

**节奏建议：**

1. 架构改动后先 `feedback:quick`（mock，0.3s）
2. 首次接 live：`feedback:live`（仅 T1）
3. T1 稳定后再 `:t2`、`:t3`；不要一上来跑 `:all`（费钱、难定位）

Live **不校验** mock 固定三文件名（真实 LLM 任务结构不同）。

| 检查项 | 通过标准 |
|--------|----------|
| 退出码 | `0` |
| 终端消息 | 无 `live mode requires DEEPSEEK_API_KEY` |
| `workflowGenerated` | 存在且未 `blocked` |
| 终态 | `workflowCompleted`（允许较长时间，脚本超时 300s） |
| 工作区 | `--keep` 保留；报告内 `execute.workspace` 可进入排查 |
| 日志 | `<workspace>/.stagent/instances/<key>/.wf-debug.log` 有完整 `llm_start/end` |

## 3.1 调试日志 — 如何定位出错位置

**是的：需要足够调试日志。** 现分三层：

| 层 | 产物 | 用途 |
|----|------|------|
| **Runner trace** | `artifacts/headless-feedback.trace.jsonl` | 按 **phase**（`generate` / `start_execution` / `await_terminal`）+ 每条 `BackendMessage` 时间线；失败含 `failurePhase` / `lastGoodPhase` |
| **场景报告** | `artifacts/headless-feedback.json` | 汇总 pass/fail、`messageTypes`、`debugLogTail`、`trace` 摘要 |
| **引擎真源** | `<ws>/.stagent/instances/<key>/.wf-debug.log` | `llm_start/end`、`stage_end`、`gen_failed` 等细粒度事件 |

**逐步控制台日志：**

```bash
HEADLESS_VERBOSE=1 npm run feedback:live
```

失败时按顺序查：

1. 终端 `phase: … (last ok: …)` — 卡在生成还是执行
2. `headless-feedback.trace.jsonl` 最后 20 行 — 最后一条 `backend` 消息类型
3. `.wf-debug.log` — 最后 `stageId` + `event`（如 `parse_success` / `stage_error`）

**Live 常见失败 → 处理：**

| 现象 | 原因 | 处理 |
|------|------|------|
| `live mode requires ...` | Key 未设或为空 | 重设 `DEEPSEEK_API_KEY` |
| `LLM API 请求失败 [401]` | Key 无效 | 控制台重新生成 Key |
| `LLM API 请求失败 [404]` | model 名错误 | 改为 `deepseek-chat` 等官方 id |
| `timeout after 300000ms` | 生成 JSON 失败 / HITL 卡住 / 网络 | 看 `debugLogTail` 最后事件；加 `--keep` 查实例目录 |
| `workflow blocked` | Rule20 / 计划门禁 | 调 `headless-platform` 的 `enableRuntimeRule20Verify: false`（已默认关）或修 workflow 结构 |
| 卡在 `paused` | 决策门 / 置信度暂停 | 脚本已自动 `approve`；若仍卡，查是否 `approveDecision` 类阶段 |

**建议 Live 工作区（可复现）：**

```bash
mkdir -p /tmp/stagent-live-ws
node scripts/headless/run.mjs --live --scenario execute --keep \
  --workspace /tmp/stagent-live-ws
```

---

## 4. 架构改动时的检查清单（每次 PR 自检）

### 4.1 改动前（基线）

```bash
cd autoAI
git rev-parse --short HEAD   # 记下 commit
npm run feedback:quick       # 基线 4/4
```

### 4.2 改动后（同一 commit 或新 commit）

```bash
npm run build:core
npm run feedback:quick
cd packages/stagent-core && npm test
```

### 4.3 若改动触及下表模块 → 加跑对应项

| 改动模块 | 加跑 |
|----------|------|
| `PlatformAdapter` / `openai-llm` | L3 live + Electron API 设置页冒烟 |
| `WorkflowGeneration*` / prompt | L1 `generate` + L3 live |
| `WorkflowExecutor` / DAG | L1 `execute` + `workflow-executor-dag.test` |
| `WorkflowInstanceManager` / resume | 手跑「崩溃恢复」或扩 headless `resume` 场景 |
| `WorkflowUiBridge` / seq | renderer vitest |
| HITL / `approveDecision` | L1 execute（mock 含 delivery pause）+ 手跑决策阶段 |

### 4.4 失败诊断顺序

1. 读 `artifacts/headless-feedback.json` → 失败场景的 `error`、`messageTypes`、`debugLogTail`
2. 若 `--keep`：打开 `execute.workspace` 下 `.stagent/instances/*/.wf-debug.log`
3. 对照 `messageTypes` 是否缺关键节点：
   - 生成：`workflowGenerated`
   - 执行：`sessionSynced` → `stageStatusUpdate`×N → `workflowCompleted`
4. 仅 live 失败而 mock 通过 → 优先查 LLM JSON 输出 / model / token 上限（`llmMaxOutputTokens` ≤8192 for deepseek）

---

## 5. 与「五项行为验收」的映射

| engine-parity 手跑项 | Headless 覆盖程度 | 缺口 |
|----------------------|-------------------|------|
| 单函数计算器 | L3 live 可近似（需换 userInput/taskType） | `pytest` / code-runner 未在 headless 验 |
| software 双切片 TDD | 未覆盖 | 需专用 scenario 或 Electron |
| 任务看板 A/B | L1 polish + generate 部分覆盖 | UI 看板、多实例切换 |
| 崩溃恢复 | 未覆盖 | 需 `resume` headless 场景 |
| 删除三档 | 未覆盖 | 需 `deleteInstance` scenario |

**结论：** Headless 环负责**引擎接线与 mock 全链路**；五项验收仍是 **Electron 手跑**签字，二者互补。

---

## 6. 推荐日常节奏（调架构期）

```
改代码
  → npm run feedback:quick     # 目标：始终 4/4，<1s
  → (触及 core 逻辑) npm test in stagent-core
  → (触及 LLM) npm run feedback:live  # 有 Key 时，每周或重大 prompt 变更
  → (周末) ./scripts/weekly-parity-check.sh
  → (里程碑) engine-parity-acceptance 五项手跑
```

---

## 7. 记录模板（每次 live 或手跑填一条）

详见 **[t4-live-iteration-log.md](./t4-live-iteration-log.md)**（T4 专项）。

| 日期 | commit | 命令 | 结果 | 备注 |
|------|--------|------|------|------|
| 2026-06-09 | `800bee53` | `feedback:live:t4` #2 | FAIL generate | workflow-gen 空响应 |
| 2026-06-09 | `800bee53` | `feedback:live:t4` #3 | FAIL generate | JSON 截断 + continue 跑偏 |
| 2026-06-09 | `800bee53` | `feedback:live:t4` #4 | PASS headless | `workflowCompleted` 但无 pytest；多文件 bundle 落盘失败 |

---

## 8. 后续可扩展的 headless 场景

| 场景 | 状态 |
|------|------|
| Live T1/T2/T3 | ✅ `live-tasks.mjs` |
| Runner trace | ✅ `trace.mjs` + `.trace.jsonl` |
| `resume` 崩溃恢复 | 待实现 |
| `blocked-rule20` | 待实现 |
| `delete-scopes` 三档 | 待实现 |
