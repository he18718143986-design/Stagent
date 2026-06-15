# ADR-0006: 难度感知模型路由（解耦 per-role 模型）

## 状态

Accepted — 2026-06-15（headless `llm-config.mjs` 接线）

## 背景

「把复杂任务拆成小切片 + 强门控，让便宜模型（DeepSeek flash）逼近强模型质量」是 Stagent 的核心成本/质量论题。但实测有边界：**decide/规划阶段产出结构化决策契约**（I-17 四节 + `behaviorSpec` + `configContent` + `modules[]`）对模型能力要求高。

实证（本仓 commit `8d09371`，2026-06-15）：

- `feedback:live:t6`（`LLM_MODEL=deepseek-v4-flash`，无角色覆盖）→ **0/1**，`stage_decide_pipeline` 经 `DecisionLintGate` 重试 4 次仍被拒（I-17 缺「AI 无法验证的假设」节、I-18 边界压力测试场景不足）。失败在 **decide 上游**，根因是 flash 在结构化决策上的能力，而非引擎或实现。

引擎侧的「按角色选模型」**已实现且有测试**，无需改：

- 角色定义 `workflow/stageClassification.ts`：`AgentRole = 'decision' | 'implementation' | 'test-write' | 'lightweight' | 'default'`；`classifyStageRoleFromId('stage_decide_*') → 'decision'`。
- 配置读取 `StagentSettings.readPreferredModelByRole`（读 `llmModelByRole`，对脏数据健壮）。
- invoker 按角色取模型、缺失回退全局 `preferredModelFamily`（`test/agent-role-model-routing.test.ts` 覆盖）。
- 值为 family 形式 `direct:<model>`，对应 OpenAI 兼容 HTTP channel。

**唯一的耦合点在 headless `scripts/headless/run.mjs`**：`roleOverrides` 仅在 `LLM_MODEL_TEST_WRITE` 被设置时构造，且把 `decision` / `test-write` / `integration` **三个角色绑死到同一个 testWrite 模型**：

```js
const roleOverrides = llm.testWrite ? {
  llmModelByRole: {
    decision: `direct:${llm.testWrite.model}`,
    'test-write': `direct:${llm.testWrite.model}`,
    integration: `direct:${llm.testWrite.model}`,
  },
} : undefined
```

后果：无法「只给 decide 升级到 pro、其余全 flash」的最省配置；要给 decision 升级就被迫连 test-write/integration 一起升级，且必须借道 `LLM_MODEL_TEST_WRITE` 这一语义不符的开关。

## 决策

### 1. 暴露独立的 per-role 模型 env（headless）

新增独立环境变量，互不耦合，各自可选带 baseUrl / apiKey 覆盖：

| Env | 路由角色 | 用途 |
|-----|----------|------|
| `LLM_MODEL_DECISION` | `decision` | decide/架构决策阶段升级（最常用） |
| `LLM_MODEL_TEST_WRITE` | `test-write` | 异族出题人（保留） |
| `LLM_MODEL_INTEGRATION` | `integration` | main 集成切片升级 |
| `LLM_MODEL_*_BASE_URL` / `LLM_MODEL_*_API_KEY` | — | 各角色可选指向不同端点/账号 |

`LLM_MODEL`（全局）仍是叶子 impl/fix 等默认角色的模型。

### 2. `buildLlmConfig` 返回 per-role map

`buildLlmConfig(ctx)` 扩展返回 `roleModels: Partial<Record<AgentRole, {model,baseUrl,apiKey}>>`（解析上述 env，未设则缺省）。`roleOverrides` 由该 map 构造，对**每个设了的角色独立路由**；`llmExtraModels` 收集 map 中所有不同模型（按 family 去重）注册到 platform。

### 3. 向后兼容（重要）

- **保留** `LLM_MODEL_TEST_WRITE` 现有「便捷三连」语义吗？决策：**改为只路由 `test-write`**，把「decision/integration 也升级」迁移到各自独立 env，避免隐式耦合带来的认知负担。
- 迁移提示：现有调用「靠 `LLM_MODEL_TEST_WRITE` 顺带升级 decision」的脚本，需显式补 `LLM_MODEL_DECISION`。在 `t4-live-iteration-log.md` 与 README 注明。
- 零配置（仅 `LLM_MODEL`）行为与历史完全一致（无角色覆盖）。

### 4. 成本可观测

`usageMeter` 已分调用计量。报告（`artifacts/headless-feedback.json` 与 stdout）**分角色汇总 token/成本**，便于评估「省钱版」相对「全 pro」的节省。

### 5. 推荐默认配置（成本优化）

```
LLM_MODEL=deepseek-v4-flash         # 叶子 impl/fix/test-run 等多数切片
LLM_MODEL_DECISION=deepseek-v4-pro  # 仅 decide/架构决策升级（阶段少、成本可控）
# 可选：多模块编排不收敛时再加
# LLM_MODEL_INTEGRATION=deepseek-v4-pro
# 可选：异族出题人提升测试质量
# LLM_MODEL_TEST_WRITE=deepseek-v4-pro
```

## 实现点

- `scripts/headless/run.mjs`：`buildLlmConfig`（约 L465）解析 per-role env；`roleOverrides`（约 L655）改为按 map 逐角色构造；`createHeadlessPlatform` 的 `llmExtraModels` 去重收集。
- 引擎：**零改动**（`llmModelByRole` + invoker 回退已就绪）。
- 测试：headless 层加 `buildLlmConfig` 的 per-role 解析单测（mock env）；复用引擎既有 `agent-role-model-routing.test.ts`。

## 验收

- `LLM_MODEL=deepseek-v4-flash` + `LLM_MODEL_DECISION=deepseek-v4-pro` 下 `feedback:live:t6` **strict pass**，且成本显著低于全 pro。
- 仅 `LLM_MODEL` 时行为与历史一致（回归保护）。

## 后果

- **正向**：以最小成本（只升级 decide）跨过 decide 能力墙；难度路由可细粒度调，按角色分别选模型/端点。
- **风险/取舍**：改 `LLM_MODEL_TEST_WRITE` 语义为「只路由 test-write」是 breaking change，需在文档与迭代日志显著提示，并给迁移指引。
- **关联**：与 ADR-0005（Node/TS 适配）正交——两者叠加即「便宜模型 + Node 交付 + 难度路由」。
