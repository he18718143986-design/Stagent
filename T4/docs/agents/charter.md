## 约束（Constraints）

- Python 3.10+；部署形态为无 Web 界面的单进程 CLI/批处理
- 首版不接实盘；broker 层必须提供 `SimBroker` 与 `BrokerAdapter` 抽象
- 公共接口用返回值表达错误，不抛异常到调用方边界外
- 指标计算不依赖 TA-Lib；使用 pandas/numpy 自实现

## 优先（Prefer）

- 优先 headless 可测：pytest 全绿为交付硬门槛
- 优先垂直切片：indicators → signals → risk → broker → main
- 优先 config.yaml 驱动参数，禁止硬编码魔法数

## 避免（Avoid）

- 避免为减文件数而合并 unrelated seam
- 避免在 signals 切片硬依赖尚未落盘的 broker 模块
- 避免单文件塞入全部业务逻辑
