"""Minimal pass fixture for hybrid G-* gate checks."""

import json
from pathlib import Path


def main() -> None:
    summary = {"open_long": 1, "open_short": 0}
    Path("backtest_summary.json").write_text(json.dumps(summary), encoding="utf-8")
    print("ok")


if __name__ == "__main__":
    main()
