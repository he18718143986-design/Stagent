# stagent-codeact-runner

Stagent 内嵌 CodeAct 执行器（Scheme A）：依赖仓库内 vendored 的 `openhands-sdk` + `openhands-tools`。

## 安装

```bash
# 从仓库根目录
npm run codeact:install
```

或手动：

```bash
python3.12 -m venv packages/codeact-runner/.venv
packages/codeact-runner/.venv/bin/pip install -e vendors/software-agent-sdk/openhands-sdk \
  -e vendors/software-agent-sdk/openhands-tools \
  -e packages/codeact-runner
```

## 冒烟

```bash
npm run codeact:smoke          # import 检查
npm run codeact:run -- --help  # CLI 帮助
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

交付判定由 Stagent `npm run gate:strict` 负责，Runner **不得**自判完成。
