# Runtime Rule 20 Fixtures（M14.4 演示用）

这些 fixture 预演 **v2.8.1 默认 ON** 时 `workflowGenerated.warnings` 的形态；显式 `stagent.enableRuntimeRule20Verify: false` 可回滚至 v2.7。

## 怎么用

```bash
npm run verify:rule20:runtime
```

该命令会用 `scripts/verify-rule20.ts` 跑这个目录下的所有 `*.json`，输出 violations / warnings。
每个 fixture 旁边的 `*.expected.txt` 是**开关 ON 时** `workflowGenerated.warnings` 数组的最终字符串形态——即 `Rule20RuntimeGate.buildGeneratorWarnings()` 的输出（含格式契约 `rule20:<type>:<stageId>` / `rule20-soft:<type>:<stageId>`）。

## 三个场景

| Fixture | 模拟的 AI 输出 | 期望命中 |
|---|---|---|
| `pass-minimal-todo-extension.json` | 干净的 4 阶段 software 工作流（2 decide + 2 impl，无 test_run） | 无 issues → `warnings = []` |
| `warn-missing-architecture.json` | 8 个 impl 但**没有**全局架构决策（疑似多模块） | 1 warning → `rule20-soft:software-missing-global-architecture-decision:workflow` |
| `fail-missing-decision-stage.json` | impl 阶段无对应 decide pair + 缺 decisionRecord source + 缺约束 prompt（典型"AI 漏掉决策"故障） | 多 violations → 多条 `rule20:*` |

> **第 3 个 fixture 用 `fail-` 前缀**：`scripts/verify-rule20.ts` 据此期望 `verifyRule20` 返回 `passed: false`，正常输出 violations 并按 expected-fail 通过校验。这正是它 violations 的"健康表现"。

## 如何对照 expected

跑真实 Stagent `generateWorkflow` 后，把 `workflowGenerated.warnings` 数组（在确认页警告行能看到）与最接近的 fixture 的 `.expected.txt` 比对，能快速判断引擎是否按 M14.4 规范输出。
