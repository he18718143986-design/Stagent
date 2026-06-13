## 运行 #54 — 2026-06-13（<一句话主题，人工填写>）

| 字段 | 值 |
|------|-----|
| instance | `test-instance` |
| 耗时 | 365s |
| headless 判定 | **FAIL** @ stage_test_run_signals |
| 阶段数 | 42 |
| 工作区 | `/tmp/T4/.headless-iter` |
| commit | `test-commit` |
| LLM 用量 | 12 次调用，in 45000 / out 8000 tok |

### 结果

- 失败：`fix chain exhausted @ signals pytest exit 1`
- 失败阶段：stage_test_run_signals（最后正常：stage_impl_signals）

### 上一轮变更预测核对（自动 · 须人工确认）

| 字段 | 内容 |
|------|------|
| 目标 Run | #54 |
| manifest 日期 | 2026-06-13 |
| 关联证据 | Run #53 草稿基准；失败 @ stage_test_run_signals；fix chain exhausted @ signals pytest exit 1 |
| 推断根因 | 例：testfix replan 未注入 behaviorSpec edge_rules |
| 本轮判定 | **FAIL** @ stage_test_run_signals |

#### 登记改动

- **chg-1**：例：buildBehaviorSpecPromptSuffix 接入 testfix（packages/stagent-core/src/...）

#### 预测修复

- [未证] 例：signals test_run exit 0 — 失败仍落在 signals 相关阶段
- [未证] 例：Run #45 类 _set_ideal_* 顺序假红不再复现 — 失败上下文仍含关键词：run

#### 预测回归

- [未出现] 例：indicators module-contract 漂移 — 失败点与预测回归关键词无交集
- [未出现] 例：plan generate parse_failed_retry — 失败点与预测回归关键词无交集

> 核对为启发式建议，非最终裁决；无效改动按文件粒度回滚（AHE 决策可观测性）。

### 根因（人工 RCA 后填写）

- <待填>

### 修复（人工填写；行为变更须附单测 + 附录 B 行）

- <待填>

### 下一轮变更预测（harness 改动**前**填写）

1. 复制模板：`cp artifacts/change-manifest.template.json artifacts/change-manifest.json`
2. 或运行：`npm run log:manifest`（从本轮失败摘要预填 evidence）
3. 填写 `predictedFixes` / `predictedRegressions`，设 `targetRun` 为 55
4. 合入 harness 改动后执行下一轮 Live，再 `npm run log:draft` 生成本节核对

| 字段 | 说明 |
|------|------|
| evidence | 本轮失败证据（Run # / stage / 摘要） |
| rootCause | 推断根因（机制类，非「模型不行」） |
| changes[] | 登记改动：id / files / what / failurePattern |
| predictedFixes | 预测下一轮应修复的现象（可多条） |
| predictedRegressions | 预测可能回归的风险（可多条） |

> 已归档 manifest → `artifacts/manifests/run-54-manifest.json`
