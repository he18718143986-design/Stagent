#!/usr/bin/env bash
# T7 Flask 对齐对比 — 验收入口（语义冻结）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q -r requirements.txt pytest pyyaml flask 2>/dev/null || \
  pip install -q -r requirements.txt pytest pyyaml flask

pytest -q
python app.py --smoke

OUT="output/smoke_report.json"
if [[ ! -f "$OUT" ]]; then
  echo "FAIL: missing $OUT" >&2
  exit 1
fi

python3 - "$OUT" <<'PY'
import json, sys
path = sys.argv[1]
with open(path) as f:
    data = json.load(f)
if not data:
    print("FAIL: empty smoke_report.json", file=sys.stderr)
    sys.exit(1)
nums = []
def walk(v):
    if isinstance(v, (int, float)):
        nums.append(v)
    elif isinstance(v, dict):
        for x in v.values():
            walk(x)
    elif isinstance(v, list):
        for x in v:
            walk(x)
walk(data)
if nums and all(v == 0 for v in nums):
    print("FAIL: smoke_report.json all-zero (hollow green)", file=sys.stderr)
    sys.exit(1)
print(f"OK: {path} has meaningful content")
PY
