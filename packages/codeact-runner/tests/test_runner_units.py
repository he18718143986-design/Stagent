"""Unit tests for stagent_codeact (no LLM)."""

from __future__ import annotations

import json
import sys
import unittest
from io import StringIO
from unittest.mock import patch

from stagent_codeact.bundle import TaskBundle
from stagent_codeact.config import (
    DEFAULT_MAX_STEPS,
    DEFAULT_TIMEOUT_MS,
    resolve_codeact_config,
)
from stagent_codeact.events import SdkEventBridge, make_sdk_callback
from stagent_codeact.protocol import emit


class ResolveCodeactConfigTests(unittest.TestCase):
    def _bundle(self, codeact: dict | None = None) -> TaskBundle:
        return TaskBundle(
            root=__import__("pathlib").Path("/tmp/bundle"),
            task={"taskId": "t", "codeact": codeact or {}},
            prompt_text="hello",
        )

    def test_defaults(self) -> None:
        cfg = resolve_codeact_config(self._bundle())
        self.assertEqual(cfg.max_steps, DEFAULT_MAX_STEPS)
        self.assertEqual(cfg.timeout_ms, DEFAULT_TIMEOUT_MS)
        self.assertFalse(cfg.enable_browser)

    def test_reads_bundle_fields(self) -> None:
        cfg = resolve_codeact_config(
            self._bundle(
                {
                    "maxSteps": 12,
                    "timeoutMs": 60000,
                    "enableBrowser": True,
                    "forbiddenPatterns": ["openctp", "np.random"],
                }
            )
        )
        self.assertEqual(cfg.max_steps, 12)
        self.assertEqual(cfg.timeout_ms, 60000)
        self.assertTrue(cfg.enable_browser)
        self.assertEqual(cfg.forbidden_patterns, ("openctp", "np.random"))


class SdkEventBridgeTests(unittest.TestCase):
    def _capture(self) -> tuple[SdkEventBridge, list[dict]]:
        lines: list[dict] = []

        class Writer(StringIO):
            def write(self, s: str) -> int:  # type: ignore[override]
                for line in s.splitlines():
                    if line.strip():
                        lines.append(json.loads(line))
                return len(s)

        sys.stdout = Writer()
        bridge = make_sdk_callback()
        return bridge, lines

    def test_terminal_action_and_observation(self) -> None:
        from openhands.sdk.event.llm_convertible.action import ActionEvent
        from openhands.sdk.event.llm_convertible.observation import ObservationEvent
        from openhands.sdk.llm import MessageToolCall, TextContent
        from openhands.tools.terminal.definition import TerminalAction, TerminalObservation

        bridge, lines = self._capture()
        bridge(
            ActionEvent(
                thought=[TextContent(text="run tests")],
                tool_name="terminal",
                tool_call_id="tc-1",
                tool_call=MessageToolCall(
                    id="tc-1",
                    name="terminal",
                    arguments="{}",
                    origin="completion",
                ),
                llm_response_id="r1",
                action=TerminalAction(command="pytest -q"),
            )
        )
        bridge(
            ObservationEvent(
                tool_name="terminal",
                tool_call_id="tc-1",
                action_id="a1",
                observation=TerminalObservation(
                    command="pytest -q",
                    exit_code=0,
                    content=[TextContent(text="1 passed")],
                ),
            )
        )
        events = [row["event"] for row in lines]
        self.assertIn("step_start", events)
        self.assertIn("terminal", events)
        self.assertIn("step_end", events)
        terminal = next(row for row in lines if row["event"] == "terminal")
        self.assertEqual(terminal["exitCode"], 0)

    def test_max_iterations_flag(self) -> None:
        from openhands.sdk.event.conversation_error import ConversationErrorEvent

        bridge, lines = self._capture()
        bridge(
            ConversationErrorEvent(
                source="environment",
                code="MaxIterationsReached",
                detail="limit",
            )
        )
        self.assertTrue(bridge.max_iterations_reached)
        self.assertEqual(lines[-1]["event"], "runner_warning")


class EmitTests(unittest.TestCase):
    def test_emit_ndjson(self) -> None:
        buf = StringIO()
        with patch.object(sys, "stdout", buf):
            emit("ping", ok=True)
        row = json.loads(buf.getvalue().strip())
        self.assertEqual(row["event"], "ping")
        self.assertTrue(row["ok"])
        self.assertIn("timestamp", row)


if __name__ == "__main__":
    unittest.main()
