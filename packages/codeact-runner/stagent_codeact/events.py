"""Map openhands-sdk conversation events to Stagent NDJSON protocol."""

from __future__ import annotations

import json
from typing import Any

from openhands.sdk.event import ActionEvent, ObservationEvent
from openhands.sdk.event.conversation_error import ConversationErrorEvent
from openhands.tools.file_editor.definition import FileEditorObservation
from openhands.tools.terminal.definition import TerminalObservation

from .protocol import emit

_STDOUT_TRUNC = 2000


def _truncate(text: str | None, limit: int = _STDOUT_TRUNC) -> str:
    if not text:
        return ""
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n…({len(text) - limit} chars truncated)"


def make_event_callback(run_state: dict[str, Any]):
    """Build a Conversation callback that emits Stagent NDJSON events."""

    def callback(event: Any) -> None:
        if isinstance(event, ActionEvent):
            emit(
                "step_start",
                tool=event.tool_name,
                summary=event.summary,
                toolCallId=str(event.tool_call_id),
            )
            return

        if isinstance(event, ObservationEvent):
            emit("step_end", tool=event.tool_name, toolCallId=str(event.tool_call_id))
            obs = event.observation
            if isinstance(obs, FileEditorObservation):
                emit(
                    "file_edited",
                    path=obs.path,
                    op=obs.command,
                    prevExist=obs.prev_exist,
                )
            elif isinstance(obs, TerminalObservation):
                stdout = ""
                try:
                    stdout = obs.content_to_str if hasattr(obs, "content_to_str") else ""
                except Exception:
                    stdout = ""
                if not stdout:
                    try:
                        parts = obs.to_llm_content
                        stdout = "\n".join(
                            getattr(p, "text", str(p)) for p in (parts or [])
                        )
                    except Exception:
                        stdout = ""
                emit(
                    "terminal",
                    command=obs.command,
                    exitCode=obs.exit_code,
                    stdout=_truncate(stdout),
                    timeout=obs.timeout,
                )
            return

        if isinstance(event, ConversationErrorEvent):
            code = getattr(event, "code", "")
            if code == "MaxIterationsReached":
                run_state["exit_reason"] = "max_steps"
            elif code and run_state.get("exit_reason") is None:
                run_state["exit_reason"] = "error"

    return callback


def emit_llm_usage(conversation: Any) -> None:
    """Emit aggregated token/cost metrics after a run."""
    try:
        stats = conversation.conversation_stats.get_combined_metrics()
        snapshot = stats.get_snapshot()
        usage = snapshot.accumulated_token_usage
        prompt = int(usage.prompt_tokens or 0) if usage else 0
        completion = int(usage.completion_tokens or 0) if usage else 0
        emit(
            "llm_usage",
            promptTokens=prompt,
            completionTokens=completion,
            cost=float(snapshot.accumulated_cost or 0.0),
        )
    except Exception as e:
        emit("llm_usage", error=str(e))


def scan_forbidden_patterns(workspace, patterns: list[str]) -> list[str]:
    """Scan workspace text files for forbidden substrings (case-insensitive)."""
    if not patterns:
        return []
    hits: list[str] = []
    lowered = [p.lower() for p in patterns if p]
    skip_dirs = {
        ".git",
        ".venv",
        "venv",
        "__pycache__",
        "node_modules",
        ".stagent-bundle",
        "artifacts",
    }
    text_suffixes = {
        ".py",
        ".txt",
        ".md",
        ".yaml",
        ".yml",
        ".json",
        ".sh",
        ".toml",
        ".cfg",
        ".ini",
    }
    for path in workspace.rglob("*"):
        if not path.is_file():
            continue
        if any(part in skip_dirs for part in path.parts):
            continue
        if path.suffix.lower() not in text_suffixes and path.name not in {
            "requirements.txt",
            "main.py",
        }:
            continue
        try:
            content = path.read_text(encoding="utf-8", errors="ignore").lower()
        except OSError:
            continue
        for raw, needle in zip(patterns, lowered, strict=False):
            if needle and needle in content:
                hits.append(f"{raw} in {path.relative_to(workspace)}")
    return hits
