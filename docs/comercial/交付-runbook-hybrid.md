# 大陆客户 Hybrid T4 一键交付 Runbook

> **适用对象**：私有化部署 autoAI / Stagent 的期货量化客户（南华 T4 回测 MVP）。  
> **SSOT**：`docs/plans/slim-stagent-codeact-integration.md`、`docs/comercial/期货策略-可验收回测规格.md`

## 1. 前置条件

| 项 | 要求 |
|----|------|
| 操作系统 | Linux / macOS（Windows 需 WSL2） |
| Node.js | ≥ 20（与仓库 `package.json` engines 一致） |
| Python | 3.11+（CodeAct Runner 自动建 venv） |
| 网络 | 可访问 DeepSeek OpenAI 兼容端点（默认 `https://api.deepseek.com/v1`） |
| 密钥 | `DEEPSEEK_API_KEY` 写入 `.env.local` 或环境变量 |

首次安装：

```bash
npm install
npm run codeact:install   # 创建 packages/codeact-runner/.venv
npm run codeact:smoke     # 验证 SDK import
```

## 2. 一键交付（推荐）

```bash
npm run deliver:t4 -- --workspace ./my-futures-ws --force --json
```

流水线：**spec:export → T4 fixture 种子 CSV → CodeAct 实现 → gate:strict**（Gate 失败最多回流 2 次）。

| 参数 | 说明 |
|------|------|
| `--workspace PATH` | 工作区（可空目录，自动创建） |
| `--mock` | 不调用 LLM（只 export + 种子 + gate，用于 CI/验收环境） |
| `--force` | 覆盖已有 fixture / seed |
| `--max-retries N` | Gate 失败后 CodeAct 回流次数（默认 2） |
| `--json` | stdout 输出完整 hybrid 报告 |

**成功标志**：exit code `0`，且存在：

- `artifacts/gate-report.json`（`pass: true`）
- `artifacts/hybrid-run.json`
- 工作区内六模块 + `signals.csv` + `backtest_summary.json` 等 MVP 产物

**失败排查**：

```bash
cat ./my-futures-ws/artifacts/gate-report.json | jq '.errors'
cat ./my-futures-ws/artifacts/hybrid-run.json | jq '.finalCategory'
```

常见 `finalCategory`：`implementation`（代码未过 pytest）、`gate_infra`（CodeAct 未启动）。

## 3. 分步命令（高级 / 调试）

```bash
# 仅导出 TaskBundle + fixture 种子
npm run spec:export -- --tier t4 --workspace ./ws --force

# 仅跑 strict Gate（bundle 与实现须已存在）
npm run gate:strict -- --workspace ./ws --task t4

# Hybrid 流水线（不含 deliver 前置种子，export 内已含 T4 CSV）
npm run hybrid:t4 -- --workspace ./ws --force
```

## 4. 批量成功率（内部 / 售前 PoC）

```bash
npm run deliver:t4:batch -- --mock --repeat 3 --json
# live（烧 API）：
npm run deliver:t4:batch -- --workspace /tmp/t4-batch --repeat 3
```

判定：通过次数 ≥ `ceil(0.6 × N)` 则 batch exit 0。

与 headless 对齐：

```bash
npm run feedback:live:t4          # 单轮 hybrid T4
npm run feedback:live:t4:batch     # 连跑 3 轮
```

## 5. 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `DEEPSEEK_API_KEY` | — | live 必填 |
| `LLM_MODEL` | `deepseek/deepseek-chat` | LiteLLM 模型 id |
| `LLM_BASE_URL` | `https://api.deepseek.com/v1` | OpenAI 兼容 base |
| `STAGENT_RUNNER` | `engine` | 设为 `hybrid` 时 headless 走 CodeAct 路径 |

## 6. 交付物清单（客户验收）

1. 运行 `npm run gate:strict -- --workspace <ws> --task t4` 全绿  
2. `pytest` 通过（含 `tests/test_e2e_signal.py`）  
3. `data/*.csv` 落盘（非 conftest 内存伪造）  
4. 无 CTP / openctp 等禁止依赖（Gate `G-no-ctp`）  
5. `DELIVERY.md` 描述与实现一致  

## 7. 与纯引擎路径的关系

- **T4 商用推荐路径**：`deliver:t4` / `feedback:live:t4 --runner hybrid`（CodeAct 实现 + Stagent Gate）。  
- 旧引擎全切片 impl（`@stagent/core` workflow）仍可通过 omit `--runner hybrid` 使用；Phase 2 计划以 `STAGENT_IMPL_ENGINE=legacy` 显式降级，默认可交付路径已切 hybrid。
