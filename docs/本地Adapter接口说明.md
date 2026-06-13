# 本地 Adapter 接口说明

## 启动

- 默认随 autoAI 主进程启动
- 默认地址：`http://127.0.0.1:8787`
- 环境变量：
  - `AUTOAI_ADAPTER_ENABLE=0` 关闭
  - `AUTOAI_ADAPTER_HOST=127.0.0.1`
  - `AUTOAI_ADAPTER_PORT=8787`

## OpenAI 兼容最小接口

### GET `/health`
- 返回服务健康状态。

### GET `/v1/models`
- 返回可用模型列表（映射自已添加站点）。
- `id` 优先使用站点 `activeModel`，否则使用 `siteId`。

### POST `/v1/chat/completions`
- 当前先支持非流式（`stream=false` 或省略）。
- 请求示例：

```json
{
  "model": "deepseek-v4-pro",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello!"}
  ],
  "stream": false
}
```

## model 到 siteId 映射规则

按顺序匹配：

1. `model === siteId`
2. `model === activeModel`
3. 命中 `availableModels[].id`
4. `hostname` 包含 `model`（兜底）

若都不命中，返回 404。

## 错误返回与诊断

失败时 `error.failure` 会附带最近一次结构化失败快照，包含：

- `errorCode`（映射为 `failure.code`）
- `stage`
- `sendSeq`
- `path`（映射为 `automationPath`）
- `siteId`
- `retryable`

可直接用于 CI 与诊断面板。

