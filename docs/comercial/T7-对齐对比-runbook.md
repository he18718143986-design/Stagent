# T7 对齐对比 Runbook — Stagent vs OpenHands（同 TaskBundle）

> **目标**：用**同一份规格**（`OPENHANDS_PROMPT.md` + `task.json`）跑 Stagent hybrid 与 OpenHands CodeAct，公平对比案例二（工程财务 CRUD）。
> **形态**：Flask + SQLite + 简单 Web UI（对齐 OpenHands `project_manager` 赛道，非旧版 T7 CLI+JSON）。

---

## 1. 共享 SSOT（两边都读这份）

导出/刷新 bundle（仓库根目录）：

```bash
npm run compare:t7:bundle
```

产物目录：`examples/bundles/t7-finance/`

| 文件 | 用途 |
|------|------|
| `OPENHANDS_PROMPT.md` | 实现者 prompt（**OpenHands 直接粘贴/引用**） |
| `task.json` | Stagent Gate / CodeAct 配置 |
| `scripts/acceptance.sh` | 语义冻结验收脚本（Gate 不替代，但实现者勿改断言） |

用户原始需求（已写入 prompt）：

> 需要开发一个小软件，在电脑上使用，包含工程进度管控、财务数据匹配、进度预警、财务预算预警、月度报表。

---

## 2. Stagent 侧（hybrid）

### 前置

```bash
npm ci
npm run codeact:install && npm run codeact:smoke
cp .env.example .env.local   # 填入 DEEPSEEK_API_KEY
```

### 单次 live

```bash
export OPENHANDS_SUPPRESS_BANNER=1
export LLM_MODEL=deepseek/deepseek-chat
export LLM_BASE_URL=https://api.deepseek.com/v1

npm run hybrid:t7 -- --workspace /tmp/stagent-t7-flask --force --json
```

成功：`exit 0`，`artifacts/gate-report.json` → pass。

### 独立复验

```bash
npm run gate:strict -- --workspace /tmp/stagent-t7-flask --task t7
```

### 公平对比：连跑 N≥3

```bash
for i in 1 2 3; do
  ws="/tmp/stagent-t7-flask-$i"
  npm run hybrid:t7 -- --workspace "$ws" --force --json || true
  echo "run $i: $(jq -r .pass "$ws/artifacts/hybrid-run.json" 2>/dev/null)"
done
```

记录：pass 次数 / 3、平均耗时、是否触发 gate 回流。

---

## 3. OpenHands 侧（同 prompt）

1. 打开 `examples/bundles/t7-finance/OPENHANDS_PROMPT.md` 全文作为任务说明。
2. 空目录作 workspace，使用 **同一模型**（建议 `deepseek-chat` + `https://api.deepseek.com/v1`）。
3. 让 CodeAct 实现至自判完成。
4. **不要**只信 `finish` — 在工作区执行：

```bash
cd <workspace>
bash scripts/acceptance.sh   # 若 agent 已复制 acceptance.sh
# 或手工：pytest -q && python app.py --smoke && 检查 output/smoke_report.json 非全零
```

5. 用下方「人工检查表」对照 Stagent Gate 等价项。

### OpenHands 使用 vendored SDK（与本仓库一致）

```bash
# 在 Stagent 仓库已 codeact:install 后
packages/codeact-runner/.venv/bin/stagent-codeact \
  --bundle examples/bundles/t7-finance \
  --workspace /tmp/openhands-t7-flask
```

（`stagent-codeact` 即 vendored OpenHands + Stagent 薄封装；**不含** Stagent Gate，需手动跑 acceptance。）

---

## 4. 统一打分表（两边都用）

| 检查项 | 通过标准 |
|--------|----------|
| 独立运行 | `pytest` 绿 + `python app.py --smoke` exit 0 |
| Flask + SQLite | 存在 `app.py`、`data.db`（或配置路径）、REST 路由 |
| Web UI | `static/js/app.js` + `templates/index.html`，fetch 真调 API |
| 进度加权 | 非手填假 percent；有 weight 逻辑 |
| 财务匹配 | category 汇总 + budget exec_rate |
| 双预警 | progress_alerts + budget_alerts 可触发 |
| 月报 | monthly_report 非平凡（非全 0） |
| 防空心绿 | 无 `np.random` 造假、无假导出按钮 |

---

## 5. 解读结果

- **清晰 CRUD 任务**上，两者都可能一次过 — 差异看 **strict pass 率** 与 **是否需人工救火**。
- Stagent 额外价值：**`gate:strict` 自动裁判** + 失败回流（implementation → fix_prompt → 再跑 CodeAct）。
- 形态已对齐 Flask 赛道；UI 细节仍可能不同，对比时以**检查表**为准，不以界面像素为准。

---

## 6. 相关路径

- Tier 定义：`scripts/headless/lib/live-tasks.mjs`（T7）
- Gate：`scripts/gate/strict.mjs` + `scripts/gate/gate-profiles.mjs`
- 案例二实测：`docs/comercial/对比-OpenHands-AIStudio-实测.md` §案例二
