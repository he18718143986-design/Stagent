# Golden Gate 回归夹具

空心绿教训来源：OpenHands 三轮 T4 探针（`docs/comercial/对比-OpenHands-AIStudio-实测.md`）。

| 夹具 | 预期 Gate | 说明 |
|------|-----------|------|
| `hollow-green-fail/` | **FAIL** | `main.py` exit 0 但无信号、无 fixture CSV — 须被 G-* 拦截 |
| `discriminating-pass-minimal/` | **PASS** | 最小 T4 形态：落盘 fixture + 非空信号 |

运行：

```bash
npm run test:headless   # 含 golden.test.mjs
npm run gate:strict -- --workspace examples/golden/hollow-green-fail --task t4
```
