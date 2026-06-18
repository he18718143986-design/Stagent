# T7 三方对比：工程进度与财务管控系统（CRUD+匹配+预警+月报）

你是 Stagent Hybrid 流水线的 **CodeAct 实现者**。请在工作区完成可交付 MVP。

## 硬性约束（违反即 Gate FAIL）

- **不得修改** `scripts/acceptance.sh`、`tests/test_e2e_signal.py`（若存在）的**断言语义**
- **不得**自判交付完成；唯一裁判是 `npm run gate:strict`
- **禁止** openctp / CTP / 任何实盘券商 SDK
- **禁止**用 `np.random` 或全局 mock 绕过指标/数据管道
- fixture CSV **必须落盘**到 `fixtures/` 或 `data/`，并在 `config.yaml` 默认路径引用
- 交付须含：`config.yaml`、模块目录、`main.py`、`tests/`、`DELIVERY.md`、`requirements.txt`

## T7 模块契约

- `models/`、`store/`、`progress/`、`finance/`、`alerts/`、`report/` + `main.py`
- 工程进度加权、财务匹配、预警、月度报表；`output.json` 不得全 0

## 验收

实现完成后由 Stagent 执行：

```bash
npm run gate:strict -- --workspace . --bundle .stagent-bundle
```
