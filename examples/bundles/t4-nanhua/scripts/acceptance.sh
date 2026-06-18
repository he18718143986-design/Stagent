#!/usr/bin/env bash
# T4 验收入口 — 语义冻结，CodeAct 不得修改断言语义。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q -r requirements.txt pytest pyyaml pandas numpy 2>/dev/null || \
  pip install -q -r requirements.txt pytest pyyaml pandas numpy

pytest -q
python main.py

SUMMARY=""
for candidate in backtest_summary.json output/backtest_summary.json summary.json; do
  if [[ -f "$candidate" ]]; then
    SUMMARY="$candidate"
    break
  fi
done

if [[ -z "$SUMMARY" ]]; then
  echo "FAIL: missing backtest_summary.json" >&2
  exit 1
fi

python3 - "$SUMMARY" <<'PY'
import json, sys
path = sys.argv[1]
with open(path) as f:
    s = json.load(f)
total = int(s.get("open_long", 0)) + int(s.get("open_short", 0))
if total < 1:
    print(f"FAIL: open_long+open_short={total} (hollow green)", file=sys.stderr)
    sys.exit(1)
print(f"OK: signals={total} from {path}")
PY
