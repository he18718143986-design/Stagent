# CodeAct 实现任务：南华期货自动下单（回测 MVP）

你是 Python 软件工程师。在工作区实现**可机器验收**的期货策略回测系统（模拟券商，不接实盘）。

## 需求真源（按优先级）

1. `期货策略-可验收回测规格.md` — 机读 SSOT（指标公式、信号谓词、输出契约、验收 oracle）
2. `需求分析-南华期货自动下单.md` — 业务背景与模块划分
3. `config.contract.yaml` — 目录与数据文件契约

## 必须交付的模块

- `indicators/` — K 线指标（MA、BOLL、VOL、MACD、CCI）
- `signals/` — 多空入场信号（3 分钟主周期 + 1 分钟确认 + 双指数共振）
- `risk/` — 止损与对冲规则
- `broker/` — `SimBroker` + `BrokerAdapter` 抽象（首版不接实盘）
- `config.yaml` — 默认数据路径指向**落盘 CSV**
- `main.py` — 无额外参数可运行：`python main.py` exit 0
- `requirements.txt` — 仅必要依赖（PyYAML、pandas、numpy、pytest）
- `tests/` — pytest 覆盖 L1/L2；**不得削弱** bundle 预置的 `tests/test_e2e_signal.py`
- `DELIVERY.md` — 运行说明（**非空**；含 `python main.py` / `pytest -q` / 数据路径）

## 完成前自检（Gate 裁判前必做）

```bash
pytest -q
python main.py
# signals.csv 含 OPEN_LONG 或 OPEN_SHORT；backtest_summary.json 中 open_long+open_short >= 1
test -s DELIVERY.md
```

## 数据与 fixture（P0）

- **必须**将样本 CSV 写入 `data/` 或 `fixtures/`，并在 `config.yaml` 默认路径引用
- 禁止仅在 `conftest.py` 内存生成数据而让 `main.py` 默认路径找不到文件
- 需要的数据文件见 `config.contract.yaml` → `dataFiles`

## 硬性禁止

- **禁止** openctp / CTP / 任何实盘券商 SDK
- **禁止**修改 `scripts/acceptance.sh`、`tests/test_e2e_signal.py` 的断言语义
- **禁止**自判交付完成；Stagent `gate:strict` 为唯一裁判
- **禁止**用 mock 替换真实指标/数据管道导致「测试绿但 signals 恒空」

## 验收口径（实现完成后由 Gate 判定）

- `pytest -q` 全绿
- `python main.py` exit 0
- `backtest_summary.json` 中 `open_long + open_short >= 1`
- `signals.csv` 非空
