# stagent

Stagent 不写代码。它记住系统由哪些已验收功能组成，每个功能靠哪些锁定的验收例子和系统亲自运行的检查证明仍然成立、由哪些代码文件承载；每次改动后告诉你哪些还成立、哪些被破坏、哪些只是 AI 声称，以及改动波及了哪些功能。

规格：[docs/spec.md](docs/spec.md)（v2.2）；任务拆分：[docs/tasks.md](docs/tasks.md)。

## 开发

需要 Node 20+。

```bash
npm install
npm run check   # 类型检查 + lint
npm test        # vitest
npm run build   # 编译到 dist/
```

## 当前进度

- [x] M1-1 项目脚手架与账本内核（事件链）—— 见 [docs/ledger.md](docs/ledger.md)
- [x] M1-2 检查快照、workTreeHash 与检查执行器 —— 见 [docs/executor.md](docs/executor.md)
- [x] M1-3 状态投影、本地服务、init 与首页结论卡 —— 见 [docs/service.md](docs/service.md)
- [x] M2-1 守卫：PreToolUse 拦截与危险命令规则 —— 见 [docs/guard.md](docs/guard.md)
- [x] M2-2 改动流程：两档、互斥、外部改动识别与状态机 —— 见 [docs/changes.md](docs/changes.md)
- [x] M2-3 授权三段式事务与服务端合并门 —— 见 [docs/auth.md](docs/auth.md)
- [ ] ★ MVP 试用检查点（tasks.md 第 4 节，不写代码，需要你在真实项目上试用）
- [x] SDK 调研 + M3-1 Claude Code 适配器 + M3-2 起草例子与先失败检查 —— 见 [docs/agent.md](docs/agent.md)
- [x] M4-1 扫描接入与基线例子 + M4-2 外观确认与「改了什么」—— 见 [docs/onboarding.md](docs/onboarding.md)
- [x] M4-3 功能文件映射与系统地图 —— 见 [docs/map.md](docs/map.md)
- [x] M4-4 需求计划 —— 见 [docs/plans.md](docs/plans.md)
- [x] M5-1 记录卡、规则提案与个人通用库 —— 见 [docs/records.md](docs/records.md)
- [x] M5-2 生成文档、交付报告与健康指标 —— 见 [docs/report.md](docs/report.md)
- [x] M6-1 完整性加固（head 锚点与恢复协议）—— 见 [docs/anchor.md](docs/anchor.md)

## CLI

```bash
stagent init                                          # 初始化 .stagent/、账本、config.json 草稿、.gitignore、守卫 hook
stagent [--port 4310] [--host 127.0.0.1] [--no-open]  # 启动本地服务
stagent ledger verify [--root <dir>]                  # 校验事件链：0 完好 / 2 锁定 / 3 版本不符
stagent ledger accept --reason <原因> [--root <dir>]   # 账本被修改时接受当前状态
stagent hook pre-tool-use                             # Claude Code PreToolUse 守卫（由 init 写入 .claude/settings.json）
```

看效果：`npm run demo`（生成示例项目并在 0.0.0.0:4310 启动；默认用演示执行器代替 Claude Code，不产生费用，`STAGENT_DEMO_AGENT=real` 改用真实的 Claude Code）。

## 环境变量

| 变量 | 作用 |
|---|---|
| `STAGENT_HOME` | `~/.stagent` 的位置（链头锚点、费用记录、个人通用库、埋点） |
| `STAGENT_AGENT=off` | 不使用 Claude Code（只用手动 / Cursor 流程） |
| `STAGENT_ANCHOR=off` | 不启用仓库外链头锚点（只校验链内一致性） |
| `ANTHROPIC_API_KEY` / Claude Code 登录 | Claude Code 适配器需要其一 |
