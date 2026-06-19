#!/usr/bin/env bash
# Default delivery stop hook — copy to .openhands/hooks/on_delivery_stop.sh
set -euo pipefail

ROOT="${OPENHANDS_WORKSPACE:-$(pwd)}"
cd "$ROOT"

failures=()

if [[ -f ACCEPTANCE.md ]]; then
  if ! grep -qE 'Given|When|Then' ACCEPTANCE.md; then
    failures+=("ACCEPTANCE.md missing Given/When/Then")
  fi
fi

if [[ -f TASKS.json ]]; then
  if grep -qE '"status"\s*:\s*"(in_progress|mock_done|integration_done)"' TASKS.json; then
    failures+=("TASKS.json has incomplete TK statuses")
  fi
fi

for script in scripts/e2e_smoke.sh scripts/acceptance.sh; do
  if [[ -f "$script" ]]; then
    if ! bash "$script"; then
      failures+=("$script failed (exit $?)")
    fi
    break
  fi
done

if [[ -f pytest.ini || -d tests ]]; then
  if command -v pytest >/dev/null 2>&1; then
    if ! pytest -q; then
      failures+=("pytest failed")
    fi
  fi
fi

if grep -R --include='*.py' --include='*.ts' --include='*.tsx' -l \
  -e '请去 API 操作' -e '功能已就绪' -e 'NotImplementedError' \
  backend frontend miniprogram src 2>/dev/null | head -1; then
  failures+=("Placeholder patterns found in source")
fi

if ((${#failures[@]} > 0)); then
  echo "Delivery stop hook denied finish:"
  printf ' - %s\n' "${failures[@]}"
  exit 2
fi

echo "Delivery stop hook passed."
exit 0
