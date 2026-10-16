# 生成文档、交付报告与健康指标（M5-2）

对应规格 §10（文档生成器）、§11（交付报告）、§14 与 tasks.md 的 M5-2。代码：`src/docs/docs.ts`、`src/report/report.ts`、`src/metrics/metrics.ts`、`src/server/flows/{docs,report}-flow.ts`。

## 生成文档

每次账本追加后（防抖 500ms）重写 `.stagent/docs/`：`features.md`（功能与例子原文、检查摘要）、`system-map.md`（系统地图）、`plan.md`（进行中的计划）、`rules.md`。目录自带 `.gitignore`（`*`），不进 git；`.stagent/docs/**` 本来就在 workTreeHash 之外，不影响证据。`system-map.md` 的内容也会给到 AI 起草计划。

## 交付报告 `GET /api/report?format=html|pdf`

只来自账本投影：

- 版本四元组：Stagent 版本 / 项目版本（package.json 或 `git describe`）/ 已验证 commit（最近一次有效运行的 endCommit）/ 生成时间；
- 功能清单：例子原文、最近一次系统验证的时间与结果（「已验证（N 个例子）」）、每条例子的先失败检查结果或豁免原因、主要功能文件；
- 账本完整性：启用锚点时写「已启用外部锚点（…/head）」，否则「仅校验链内一致性（未启用外部锚点）」；`ledger.integrity_override` 显式标注「用户接受了无法证明完整性的状态」，TOFU、从 git 恢复、崩溃恢复也列出；
- 需求计划（已确认的）；
- 全部授权放行记录：普通 merge 如实写「免填原因」，其余写原因与结果（悬挂的写「未结算」）；发布记录与退出码；
- 未验证项（含「已知不一致」「结果不稳定」）与「AI 声称完成但系统未验证通过」（标「仅 AI 声称」）；
- 关键技术方案：`decision` 类记录（授权自动生成的除外）。

PDF 用 Playwright 的 `page.pdf()`：项目里装了 `playwright` 且 Chromium 能启动时返回 PDF；否则降级为 HTML，报告顶部和响应头 `X-Stagent-Report-Note` 注明原因。

## 健康指标（§14）

写入 `~/.stagent/metrics.jsonl`（不进事件链）：`red_check.result`（先失败检查合格率）、`red_check.waived`、`flaky.detected`、`run.invalid`、`regression.caught`（被破坏的已验收功能在合并前被全量回归发现）、`claim.refuted`（仅 AI 声称被系统证伪）、`plan.created`、`decision.dwell`（决策卡停留时间）、界面事件 `ui.*`（`POST /api/metrics`：打开抽屉、地图、计划页）。
