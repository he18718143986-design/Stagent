"""L3 E2E oracle — semantic frozen. Do not weaken assertions.

Stagent Gate 依赖本文件的断言语义；CodeAct 实现者不得修改断言逻辑。
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _find_summary() -> Path | None:
    for rel in ("backtest_summary.json", "output/backtest_summary.json", "summary.json"):
        p = ROOT / rel
        if p.is_file() and p.stat().st_size > 0:
            return p
    return None


def test_main_exit_zero_default():
    """无额外参数 python main.py 必须 exit 0（G-default-main-exit0）。"""
    result = subprocess.run(
        [sys.executable, str(ROOT / "main.py")],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, (
        f"main.py exit {result.returncode}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )


def test_backtest_summary_nonzero():
    """backtest_summary.json 须含 open_long+open_short >= 1（空心绿检测）。"""
    summary_path = _find_summary()
    assert summary_path is not None, "missing backtest_summary.json after main.py"

    with summary_path.open(encoding="utf-8") as f:
        summary = json.load(f)

    total = int(summary.get("open_long", 0)) + int(summary.get("open_short", 0))
    assert total >= 1, (
        f"hollow green: open_long={summary.get('open_long')}, "
        f"open_short={summary.get('open_short')}, full={summary}"
    )


def test_signals_csv_or_summary_has_rows():
    """signals.csv 有数据行，或 summary 已证明非空。"""
    sig = ROOT / "signals.csv"
    if sig.is_file():
        lines = [ln for ln in sig.read_text(encoding="utf-8").splitlines() if ln.strip()]
        if len(lines) > 1:
            return
    summary_path = _find_summary()
    assert summary_path is not None, "no signals.csv data and no summary"
    with summary_path.open(encoding="utf-8") as f:
        summary = json.load(f)
    total = int(summary.get("open_long", 0)) + int(summary.get("open_short", 0))
    assert total >= 1
