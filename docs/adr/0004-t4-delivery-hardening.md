# ADR-0004: T4 真实交付加固（Engine + Headless）

## 状态

Accepted — 2026-06-10

## 背景

Headless T4 回归「绿」仅表示 Stagent 流水线跑通，不等于南华期货 MVP 按需求文档交付。根因为三层标准错位：headless 容忍 runner 失败、engine 在 test_run 红时仍 delivery、Path Router 将多模块 software 压成 express 单切片。

## 决策

### 1. `blockDeliveryOnTestFailure`

- **默认 `true`** 当 `taskType === 'software'`
- **默认 `false`** 当 `taskType` 为 `prototype` / `document` / `refactor` 等
- 显式设置 `execution.blockDeliveryOnTestFailure` 可覆盖
- fix 链耗尽且 test 仍红 → `workflowFailed`，不进入 delivery
- delivery 阶段 prelude：任一 `stage_test_run_*` exit ≠ 0 → fail

### 2. Delivery `skipIf`

- 类型：`anyTestRunFailed`（非 `allTestRunsGreen`）
- skipIf 为 true 时跳过 delivery；software + blockDelivery 时改为 hard fail

### 3. `multiModuleLayout` 检测（SSOT）

模块：`path-router/multiModuleLayoutDetect.ts`

```
检测条件（AND）：
  taskType === 'software'
  AND pathLikeTokenCount(userInput ∪ 需求文档) >= 4

pathLikeToken：
  - 含 `/` 的路径片段（indicators/、signals/ 等）
  - 或 `*.py` 文件名 token
```

- Path Router：`detectMultiModuleLayout` → 禁止 express
- Plan lint：`express-incompatible-module-layout` → hard block

### 4. Headless Strict 档（T4/T5）

- `pass.strict: true`；禁止 `acceptRunnerFailure`
- `assertStrictMvpPass`：workflowCompleted + pytest 全绿 + MVP 目录 + traceability
- strict pass + `--keep` → `promoteIterToT4Root` 到 `T4/`

### 5. 测试契约

- `TestQualityLint`：`test-inline-impl-double`、`test-no-production-import`（内联 impl 类且无生产 import）

### 6. Charter Gate 2（接缝，后续）

- **P1-1** 覆盖 Path Router / 计划形态（禁 express、多切片）
- **Charter Gate 2**（Charter-Grill PR-1 后）：决策阶段拦截「单文件实现」等与 charter 模块结构冲突的批准
- 不阻塞本 ADR 的 P0/P1 落地

## 后果

- T3 software 仍可在 headless 层 `acceptRunnerFailure`；engine 层默认 block delivery on red test
- T4/T5 live 必须通过 strict MVP 才算「真实交付 pass」
- `feedback:live:all` 报告分栏 pipeline vs strict delivery
