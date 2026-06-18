#!/usr/bin/env bash
# Install vendored openhands-sdk + stagent-codeact-runner into local venv (Scheme A).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VENV="${STAGENT_CODEACT_VENV:-$ROOT/packages/codeact-runner/.venv}"
SDK="$ROOT/vendors/software-agent-sdk"
RUNNER="$ROOT/packages/codeact-runner"

PY=""
for candidate in "${STAGENT_PYTHON:-}" python3.13 python3.12; do
  if [[ -n "$candidate" ]] && command -v "$candidate" >/dev/null 2>&1; then
    PY="$candidate"
    break
  fi
done
if [[ -z "$PY" ]]; then
  echo "ERROR: openhands-sdk requires Python >=3.12. Install python3.12 or set STAGENT_PYTHON." >&2
  exit 1
fi

echo "==> Stagent CodeAct venv: $VENV"
echo "==> Python: $($PY --version)"

"$PY" -m venv "$VENV"
# shellcheck disable=SC1091
source "$VENV/bin/activate"

pip install -q --upgrade pip wheel setuptools

echo "==> Installing vendored openhands-sdk + openhands-tools (editable)..."
pip install -q -e "$SDK/openhands-sdk" -e "$SDK/openhands-tools"

echo "==> Installing stagent-codeact-runner (editable)..."
pip install -q -e "$RUNNER"

echo "==> Done. Activate: source $VENV/bin/activate"
echo "==> Smoke: npm run codeact:smoke"
