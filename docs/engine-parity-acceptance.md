# autoAI 引擎对齐验收与防漂移

## 周度 parity 流程

```bash
cd autoAI
./scripts/weekly-parity-check.sh
```

产出 `artifacts/engine-parity.json` / `.csv`；默认 `ENGINE_GAP_MAX=0`（扩展/UI 条目已 `parity_exempt`）；`vscode_only=true` 且非 exempt 的目录进入移植 backlog。

## E2E 手跑清单（CI 不覆盖）

以下五项需在 Electron 应用中手跑并记录结果（见各用例通过标准）：

1. 冒烟：单函数计算器
2. software 双切片 TDD
3. 任务看板 A/B
4. 崩溃恢复（`instanceResumed` + `stageStatuses`）
5. 删除三档

## 五项行为验收

| 用例 | 命令 / 操作 | 通过标准 |
|------|-------------|----------|
| 冒烟：单函数计算器 | 空目录 + Express 需求 → 生成 → 执行 | ≤8 stage，`pytest` 绿，产物落盘 |
| software：双切片 TDD | `taskType=software`，棕场小改 | RED→GREEN，`.wf-debug.log` 完整 |
| 任务看板 A/B | 润色 → 生成 → 执行 | 可运行项目文件 |
| 崩溃恢复 | 执行中杀进程 → `resumeInstance` | `instanceResumed` + DAG 续跑 |
| 删除三档 | `deleteInstance(record/artifacts/folder)` | 磁盘与 globalState 一致 |

### 手跑记录模板（每项一条）

| 字段 | 填写 |
|------|------|
| 日期 | YYYY-MM-DD |
| commit | `git rev-parse --short HEAD` |
| 操作者 | |
| 前置 | 工作区路径、API key、`taskWorkspacePath` |
| 步骤 | 逐步操作与关键 UI 点击 |
| 期望消息 | `BackendMessage` 序列（如 `workflowGenerated` → `stageStatusUpdate`） |
| 结果 | pass / fail |
| 备注 | 截图路径、日志片段 |

五项全部 **pass** 后，在本文件顶部标注：`behavioral parity: passed`（日期 + commit）。

## 回归门槛

- `@stagent/core`：`npm test` ≥ 585 用例全绿
- renderer：`npx vitest run src/renderer/src/__tests__` 全绿（`verify-engine.yml`）
- `provider-chain`：`jsonMode` 强制 structured 委托优先

## 独立项目原则

- `stagent_vscode` 为能力参考真源；变更走 `stagent_docs/` PR，两边各自实现
- 不合并仓库；不引入 `vscode` 运行时到 `@stagent/core`
