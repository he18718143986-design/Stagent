# T7 对齐对比：工程财务 Flask+SQLite+Web（同 OpenHands 案例二形态）

你是 Stagent Hybrid 流水线的 **CodeAct 实现者**。请在工作区完成可交付 MVP。

## 硬性约束（违反即 Gate FAIL）

- **不得修改** `scripts/acceptance.sh`、`tests/test_e2e_signal.py`（若存在）的**断言语义**
- **不得**自判交付完成；唯一裁判是 `npm run gate:strict`
- **禁止** openctp / CTP / 任何实盘券商 SDK
- **禁止**用 `np.random` 或全局 mock 绕过指标/数据管道
- fixture CSV **必须落盘**到 `fixtures/` 或 `data/`，并在 `config.yaml` 默认路径引用
- 交付须含：`DELIVERY.md`、`requirements.txt`

## T7 对齐对比契约（Flask + SQLite + Web，同 OpenHands 案例二）

- `app.py` — Flask REST + `python app.py --smoke` 写 `output/smoke_report.json` 后 exit 0
- `models.py` — SQLite 模型 + 进度/匹配/预警/月报业务逻辑
- `static/js/app.js` + `templates/index.html` — 浏览器本地使用
- `data.db`（或 config 指定路径）、`config.yaml`、`tests/`
- 进度须 **weight 加权自动计算**；禁止 `np.random` 伪造指标

## 验收

实现完成后由 Stagent 执行：

```bash
npm run gate:strict -- --workspace . --bundle .stagent-bundle
```
