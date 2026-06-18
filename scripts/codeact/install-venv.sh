#!/usr/bin/env bash
# Install vendored openhands-sdk + stagent-codeact-runner into local venv (Scheme A).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VENV="${STAGENT_CODEACT_VENV:-$ROOT/packages/codeact-runner/.venv}"
SDK="$ROOT/vendors/software-agent-sdk"
RUNNER="$ROOT/packages/codeact-runner"
REQ_VENDORED="$RUNNER/requirements-vendored.txt"

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

if ! command -v tmux >/dev/null 2>&1; then
  if [[ "${STAGENT_ALLOW_NO_TMUX:-}" == "1" ]]; then
    echo "WARN: tmux not found — TerminalTool will fail at runtime (STAGENT_ALLOW_NO_TMUX=1)." >&2
  else
    echo "ERROR: tmux is required for TerminalTool." >&2
    echo "  Install: apt install tmux   # Debian/Ubuntu" >&2
    echo "           brew install tmux  # macOS" >&2
    echo "  Or set STAGENT_ALLOW_NO_TMUX=1 to skip this check (CI without terminal tests)." >&2
    exit 1
  fi
fi

for pkg in openhands-sdk openhands-tools; do
  if [[ ! -f "$SDK/$pkg/pyproject.toml" ]]; then
    echo "ERROR: missing vendored package: $SDK/$pkg (run Scheme A vendoring first)." >&2
    exit 1
  fi
done

if [[ ! -f "$REQ_VENDORED" ]]; then
  echo "ERROR: missing $REQ_VENDORED" >&2
  exit 1
fi

echo "==> Stagent CodeAct venv: $VENV"
echo "==> Python: $($PY --version)"
echo "==> Vendored SDK: $SDK (see requirements-vendored.txt)"

"$PY" -m venv "$VENV"
# shellcheck disable=SC1091
source "$VENV/bin/activate"

pip install -q --upgrade pip wheel setuptools

echo "==> Installing vendored openhands-sdk + openhands-tools (editable, from requirements-vendored.txt)..."
( cd "$RUNNER" && pip install -q -r requirements-vendored.txt )

echo "==> Installing stagent-codeact-runner (editable, --no-deps to avoid PyPI openhands-*)..."
pip install -q -e "$RUNNER" --no-deps

echo "==> Done. Activate: source $VENV/bin/activate"
echo "==> Smoke: npm run codeact:smoke"
