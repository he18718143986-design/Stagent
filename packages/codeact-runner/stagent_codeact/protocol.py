"""NDJSON event protocol for Stagent ↔ CodeAct runner IPC."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from typing import Any


def emit(event: str, **payload: Any) -> None:
    """Write one JSON line to stdout (NDJSON)."""
    record = {
        "event": event,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **payload,
    }
    sys.stdout.write(json.dumps(record, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def emit_runner_done(reason: str, **extra: Any) -> None:
    emit("runner_done", reason=reason, **extra)


def emit_runner_failed(message: str, retryable: bool = True, **extra: Any) -> None:
    emit("runner_failed", message=message, retryable=retryable, **extra)
