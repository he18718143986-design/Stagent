# Fixture 数据（必须落盘）

CodeAct 实现者**必须**在本目录或 `data/` 写入真实 CSV，并在 `config.yaml` 默认路径引用。

## T4 必需文件

| 文件 | 说明 |
|------|------|
| `data/bars_3m.csv` | 主力合约 3 分钟 K 线 |
| `data/bars_1m.csv` | 主力合约 1 分钟 K 线 |
| `data/index_sh.csv` | 上证指数 |
| `data/index_sz.csv` | 深证成指 |

表头与字段定义见 `期货策略-可验收回测规格.md` §2。

**禁止**仅在 `tests/conftest.py` 内生成数据而不落盘——Gate `G-fixtures-on-disk` 会 FAIL。
