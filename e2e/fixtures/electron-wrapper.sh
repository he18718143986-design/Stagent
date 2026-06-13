#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON_BIN="$(node -e "process.stdout.write(require('electron'))")"
LOADER="$SCRIPT_DIR/electron-loader.cjs"

filtered_args=()
for arg in "$@"; do
  if [[ "$arg" == "--remote-debugging-port=0" ]]; then
    continue
  fi
  filtered_args+=("$arg")
done

exec "$ELECTRON_BIN" -r "$LOADER" "${filtered_args[@]}"
