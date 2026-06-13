#!/usr/bin/env bash
# 周度引擎 parity 防漂移：生成缺口矩阵 + engine_gap 门槛 + core 测试回归。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PARITY_JSON="$ROOT/artifacts/engine-parity.json"
ENGINE_GAP_MAX="${ENGINE_GAP_MAX:-0}"

echo "== engine parity matrix =="
node scripts/engine-parity-matrix.mjs --json "$PARITY_JSON"

ENGINE_GAP="$(node -e "const s=require('$PARITY_JSON'); console.log(s.engine_gap_count ?? s.vscode_only_count)")"
EXEMPT="$(node -e "const s=require('$PARITY_JSON'); console.log(s.parity_exempt_count ?? 0)")"
echo ""
echo "engine_gap=$ENGINE_GAP parity_exempt=$EXEMPT (max allowed: $ENGINE_GAP_MAX)"
if [ "$ENGINE_GAP" -gt "$ENGINE_GAP_MAX" ]; then
  echo "FAIL: engine_gap $ENGINE_GAP exceeds ENGINE_GAP_MAX=$ENGINE_GAP_MAX" >&2
  exit 1
fi

echo ""
echo "== @stagent/core tests =="
(cd packages/stagent-core && npm test)
echo ""
echo "== provider-chain tests =="
(cd "$ROOT" && npm run test:main -- --run src/main/stagent/provider-chain.test.ts 2>/dev/null || npx vitest run src/main/stagent/provider-chain.test.ts)
echo ""
echo "Parity report: $PARITY_JSON"
