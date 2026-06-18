#!/usr/bin/env bash
# T7 验收入口 — 语义冻结。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q -r requirements.txt pytest pyyaml 2>/dev/null || \
  pip install -q -r requirements.txt pytest pyyaml

pytest -q
python main.py

OUT=""
for candidate in output.json output/output.json; do
  if [[ -f "$candidate" ]]; then
    OUT="$candidate"
    break
  fi
done

if [[ -z "$OUT" ]]; then
  echo "FAIL: missing output.json" >&2
  exit 1
fi

python3 - "$OUT" <<'PY'
import json, sys
path = sys.argv[1]
with open(path) as f:
    data = json.load(f)
if not data:
    print("FAIL: empty output.json", file=sys.stderr)
    sys.exit(1)
nums = [v for v in data.values() if isinstance(v, (int, float))]
if nums and all(v == 0 for v in nums):
    print("FAIL: output.json all-zero (hollow green)", file=sys.stderr)
    sys.exit(1)
print(f"OK: {path} has meaningful content")
PY
