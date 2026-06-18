#!/usr/bin/env bash
# Verify vendored CodeAct stack imports (no LLM call).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VENV="${STAGENT_CODEACT_VENV:-$ROOT/packages/codeact-runner/.venv}"

if [[ ! -x "$VENV/bin/python" ]]; then
  echo "Missing venv. Run: npm run codeact:install" >&2
  exit 1
fi

if ! command -v tmux >/dev/null 2>&1; then
  echo "WARN: tmux not in PATH — TerminalTool will not work at runtime." >&2
fi

pip_show="$("$VENV/bin/pip" show openhands-sdk)"
echo "$pip_show" | grep -E '^(Name|Version|Editable project location):'

editable_loc="$(echo "$pip_show" | awk -F': ' '/^Editable project location:/{print $2}')"
if [[ -z "$editable_loc" ]] || [[ "$editable_loc" != *"vendors/software-agent-sdk/openhands-sdk"* ]]; then
  echo "ERROR: openhands-sdk is not installed editable from vendors/ (got: ${editable_loc:-PyPI wheel})" >&2
  echo "Re-run: npm run codeact:install" >&2
  exit 1
fi

"$VENV/bin/python" -c "
from openhands.sdk import LLM, Agent, Conversation, Tool
from openhands.tools.terminal import TerminalTool
from openhands.tools.file_editor import FileEditorTool
from openhands.tools.task_tracker import TaskTrackerTool
import stagent_codeact
print('openhands-sdk + openhands-tools + stagent_codeact OK', stagent_codeact.__version__)
"

"$VENV/bin/stagent-codeact" run --help >/dev/null
echo "stagent-codeact CLI OK"
