# stagent-codeact-runner

Stagent 内嵌 CodeAct 执行器（Scheme A）：依赖仓库内 vendored 的 `openhands-sdk` + `openhands-tools`。

## 安装

```bash
# 从仓库根目录（需 Python >=3.12、tmux）
npm run codeact:install
```

依赖来源为 **vendored 源码**（`requirements-vendored.txt`），**不会**从 PyPI 安装 `openhands-sdk`。`pyproject.toml` 中 `dependencies = []`，避免与 editable vendoring 混用。

| 文件 | 作用 |
|------|------|
| `requirements-vendored.txt` | 安装 SSOT：`-e ../../vendors/.../openhands-{sdk,tools}` |
| `pyproject.toml` `[tool.stagent-codeact-runner]` | 文档化 vendored 路径与版本 |
| `scripts/codeact/install-venv.sh` | 创建 venv、装 vendored、再 `pip install -e . --no-deps` |

无 tmux 时安装失败（可用 `STAGENT_ALLOW_NO_TMUX=1` 跳过，仅适合无 terminal 的 CI）。

## 冒烟与单测

```bash
npm run codeact:smoke
npm run codeact:test
```

## 运行任务

```bash
export DEEPSEEK_API_KEY=...
export LLM_MODEL=deepseek/deepseek-chat
export LLM_BASE_URL=https://api.deepseek.com

packages/codeact-runner/.venv/bin/stagent-codeact run \
  --bundle /path/to/.stagent-bundle \
  --workspace /path/to/ws
```

Gate 回流（长报告用文件，避免命令行长度限制）：

```bash
stagent-codeact run --bundle ... --workspace ... --fix-prompt-file ./artifacts/fix_prompt.md
```

## `task.json` → SDK 接线

| Bundle 字段 | SDK / Runner 行为 |
|-------------|-------------------|
| `codeact.maxSteps` | `Conversation(max_iteration_per_run=…)`，默认 80 |
| `codeact.timeoutMs` | 会话墙钟超时（毫秒），默认 2400000 |
| `codeact.enableBrowser` | `get_default_tools(enable_browser=…)` |
| `codeact.forbiddenPatterns` | 追加到用户 Prompt 纪律段 |

## 进程退出码

| code | 含义 |
|------|------|
| 0 | CodeAct 会话正常结束（**不等于** Gate 通过） |
| 1 | 配置/环境/运行时错误 |
| 2 | 墙钟超时 `runner_done.reason=timeout` |
| 3 | 达到 `maxSteps` `runner_done.reason=max_steps` |

## NDJSON 事件（stdout）

| event | 说明 |
|-------|------|
| `runner_start` | 含 `maxSteps`、`timeoutMs` |
| `step_start` / `step_end` | 工具动作与观察 |
| `terminal` | 命令与 `exitCode` |
| `file_edited` | 路径与操作 |
| `runner_warning` | SDK `ConversationErrorEvent`（含 MaxIterationsReached） |
| `runner_done` | `reason`: completed \| max_steps \| timeout |

交付判定由 Stagent `npm run gate:strict` 负责，Runner **不得**自判完成。
