# 扫描接入、基线例子、外观确认与「改了什么」（M4-1、M4-2）

对应规格 §7（visual）、§9、§11 与 tasks.md 的 M4-1、M4-2。代码：`src/server/flows/examples-flow.ts`、`src/server/flows/map-flow.ts`（diff 视图）。

## 接入（§9）

1. `stagent init` 检测技术栈、写 config 草稿（M1-3 起已有；`.gitignore` 新增 `.stagent/docs/`）。
2. 结论卡「扫描现有代码」→ `POST /api/scan`：Claude Code 只读扫描路由、页面和接口，**每识别一个功能就写一条** `feature.created { origin: 'scan', entryFiles }`（SSE `scan.feature`），全部未验证；入口文件成为系统地图的初始映射。
3. 首页「接入现有项目」勾选 3–5 个核心功能 → `POST /api/features/:id/baseline`：Claude Code 起草基线例子（`example.drafted { baseline: true }`，写在 `.stagent/checks/draft/baseline/<功能>/`）。也可以手写：`POST /api/features/:id/baseline/manual`。
4. 锁定前草稿可以自由修改，不需要授权：`PUT /api/examples/:id/draft`。
5. `POST /api/baseline/lock`：写快照与 `example.locked { redCheck: { baseline: true } }`，再跑一次 `purpose: 'baseline'`（基线描述已有行为，不做先失败检查）。
6. 基线失败不自动改代码，抽屉里的决策卡三选一：修改例子（`modify_locked`）/ 作为新改动去修复 / 接受现状（`POST /api/examples/:id/known-inconsistent`：写 `example.known_inconsistent` + 一条 `pitfall` 记录，功能标「已知不一致」，不阻塞账本，交付报告列出；之后一旦通过自动解除）。
7. 其余功能显示「尚无例子」，抽屉里有「补例子」。

## 外观例子（§7 visual）

- 执行器给每个检查一个环境变量 `STAGENT_SCREENSHOT_PATH`（`.stagent/runs/<runId>/screenshots/<exampleId>.png`）。Playwright 检查里 `await page.screenshot({ path: process.env.STAGENT_SCREENSHOT_PATH })`；文件存在时写入 `CheckResult.screenshot`。Stagent 本身不依赖 Playwright。
- 改动全部通过且有外观例子 → 「待你确认外观」。`POST /api/visual/:exampleId { ok, note? }` 写 `visual.confirmed`；不满意必须附说明，改动回到实现中，Claude Code 可用时带着说明继续（不计入 3 轮上限）。
- 截图与日志经 `GET /api/files?path=` 读取，只允许 `.stagent/runs/` 下的文件。

## 「改了什么」（D20）

`GET /api/changes/:id/diff`：基准 → 工作区（含未跟踪文件，不含 `.stagent/`）、文件数与增删行数、来源；AI 回报里「改了什么」（标为仅声称）；触及的功能；超出本功能的改动；被破坏功能的可能相关文件；外观例子的改前 / 改后截图；每个文件的归属（可修改）与可展开的 diff。

开发服务器起不来时，`POST /api/config/dev-server { command, url }` 修改启动命令（config 在 workTreeHash 范围内，证据会过期——预期行为）。
