"""Map openhands-sdk events to Stagent NDJSON protocol."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from openhands.sdk.event import Event
from openhands.sdk.event.conversation_error import ConversationErrorEvent
from openhands.sdk.event.llm_convertible.action import ActionEvent
from openhands.sdk.event.llm_convertible.observation import ObservationEvent
from openhands.sdk.llm import content_to_str
from openhands.tools.file_editor.definition import FileEditorObservation
from openhands.tools.terminal.definition import TerminalObservation

from .protocol import emit

_TRUNCATE = 4000


def _truncate(text: str | None, limit: int = _TRUNCATE) -> str:
    if not text:
        return ""
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n…[{len(text) - limit} chars truncated]"


def _action_payload(event: ActionEvent) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "tool": event.tool_name,
        "toolCallId": str(event.tool_call_id),
    }
    if event.summary:
        payload["summary"] = event.summary
    action = event.action
    if action is None:
        return payload

    if event.tool_name == "terminal":
        payload["command"] = getattr(action, "command", None)
        payload["isInput"] = bool(getattr(action, "is_input", False))
    elif event.tool_name == "file_editor":
        payload["path"] = getattr(action, "path", None)
        payload["op"] = getattr(action, "command", None)
    else:
        payload["actionKind"] = type(action).__name__

    return payload


def _observation_payload(event: ObservationEvent) -> dict[str, Any]:
    obs = event.observation
    payload: dict[str, Any] = {
        "tool": event.tool_name,
        "toolCallId": str(event.tool_call_id),
    }

    if isinstance(obs, FileEditorObservation):
        payload["path"] = obs.path
        payload["op"] = obs.command
        payload["prevExist"] = obs.prev_exist
        return payload

    if isinstance(obs, TerminalObservation):
        stdout = ""
        try:
            stdout = obs.content_to_str if hasattr(obs, "content_to_str") else ""
        except Exception:
            stdout = ""
        if not stdout:
            try:
                stdout = "\n".join(
                    getattr(p, "text", str(p)) for p in (obs.to_llm_content or [])
                )
            except Exception:
                stdout = ""
        payload["command"] = obs.command
        payload["exitCode"] = obs.exit_code
        payload["stdout"] = _truncate(stdout)
        payload["timeout"] = obs.timeout
        return payload

    payload["preview"] = _truncate("".join(content_to_str(obs.to_llm_content)))
    return payload


class SdkEventBridge:
    """Accumulates SDK callbacks and emits Stagent NDJSON events."""

    def __init__(self) -> None:
        self.max_iterations_reached = False
        self.last_error_code: str | None = None
        self.last_error_detail: str | None = None
        self.action_count = 0
        self.observation_count = 0

    def __call__(self, event: Event) -> None:
        if isinstance(event, ActionEvent):
            self.action_count += 1
            emit("step_start", kind="action", **_action_payload(event))
            return

        if isinstance(event, ObservationEvent):
            self.observation_count += 1
            payload = _observation_payload(event)
            if event.tool_name == "terminal":
                emit("terminal", **payload)
            elif event.tool_name == "file_editor":
                emit("file_edited", **payload)
            else:
                emit("observation", **payload)
            emit("step_end", kind="observation", tool=event.tool_name)
            return

        if isinstance(event, ConversationErrorEvent):
            self.last_error_code = event.code
            self.last_error_detail = event.detail
            if event.code == "MaxIterationsReached":
                self.max_iterations_reached = True
            emit(
                "runner_warning",
                code=event.code,
                message=_truncate(event.detail),
            )


def make_sdk_callback() -> SdkEventBridge:
    return SdkEventBridge()


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


def scan_forbidden_patterns(workspace: Path, patterns: list[str]) -> list[str]:
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
