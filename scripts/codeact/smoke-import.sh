#!/usr/bin/env bash
# Verify vendored CodeAct stack imports (no LLM call).
set -euo pipefail

export OPENHANDS_SUPPRESS_BANNER="${OPENHANDS_SUPPRESS_BANNER:-1}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VENV="${STAGENT_CODEACT_VENV:-$ROOT/packages/codeact-runner/.venv}"

if [[ ! -x "$VENV/bin/python" ]]; then
  echo "Missing venv. Run: npm run codeact:install" >&2
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
