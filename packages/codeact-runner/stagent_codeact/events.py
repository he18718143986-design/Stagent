"""Map openhands-sdk events to Stagent NDJSON protocol."""

from __future__ import annotations

from typing import Any

from openhands.sdk.event import Event
from openhands.sdk.event.conversation_error import ConversationErrorEvent
from openhands.sdk.event.llm_convertible.action import ActionEvent
from openhands.sdk.event.llm_convertible.observation import ObservationEvent
from openhands.sdk.llm import content_to_str

from .protocol import emit

_TRUNCATE = 4000


def _truncate(text: str, limit: int = _TRUNCATE) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n…[{len(text) - limit} chars truncated]"


def _action_payload(event: ActionEvent) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "tool": event.tool_name,
        "toolCallId": event.tool_call_id,
    }
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
    text = _truncate("".join(content_to_str(obs.to_llm_content)))
    payload: dict[str, Any] = {
        "tool": event.tool_name,
        "toolCallId": event.tool_call_id,
        "preview": text,
    }
    if event.tool_name == "terminal":
        payload["exitCode"] = getattr(obs, "exit_code", None)
        payload["command"] = getattr(obs, "command", None)
    elif event.tool_name == "file_editor":
        payload["path"] = getattr(obs, "path", None)
        payload["op"] = getattr(obs, "command", None)
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
