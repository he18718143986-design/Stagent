"""Unit tests for stagent_codeact (L0 — no LLM calls)."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from openhands.sdk.llm.utils.metrics import MetricsSnapshot, TokenUsage

from stagent_codeact.bundle import TaskBundle, load_bundle, resolve_llm_from_bundle
from stagent_codeact.config import (
    DEFAULT_MAX_STEPS,
    DEFAULT_TIMEOUT_MS,
    resolve_codeact_config,
)
from stagent_codeact.events import (
    SdkEventBridge,
    emit_llm_usage,
    make_sdk_callback,
    scan_forbidden_patterns,
)
from stagent_codeact.protocol import emit


class ProtocolTests(unittest.TestCase):
    def test_emit_ndjson(self) -> None:
        buf = StringIO()
        with patch("stagent_codeact.protocol.sys.stdout", buf):
            emit("runner_start", taskId="t1")
        data = json.loads(buf.getvalue().strip())
        self.assertEqual(data["event"], "runner_start")
        self.assertEqual(data["taskId"], "t1")
        self.assertIn("timestamp", data)


class BundleTests(unittest.TestCase):
    def test_load_bundle_merges_spec_refs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "task.json").write_text(
                json.dumps(
                    {
                        "taskId": "test-task",
                        "specRefs": ["spec.md"],
                        "codeact": {"maxSteps": 42},
                        "llm": {"apiKeyEnv": "DEEPSEEK_API_KEY"},
                    }
                ),
                encoding="utf-8",
            )
            (root / "OPENHANDS_PROMPT.md").write_text("# Prompt", encoding="utf-8")
            (root / "spec.md").write_text("# Spec body", encoding="utf-8")
            bundle = load_bundle(root)
            self.assertEqual(bundle.task_id, "test-task")
            self.assertEqual(bundle.codeact_config.get("maxSteps"), 42)
            self.assertIn("Spec body", bundle.prompt_text)

    def test_resolve_llm_requires_api_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "task.json").write_text(
                json.dumps({"llm": {"apiKeyEnv": "MISSING_KEY_XYZ"}}),
                encoding="utf-8",
            )
            bundle = load_bundle(root)
            with patch.dict("os.environ", {}, clear=True):
                with self.assertRaises(EnvironmentError):
                    resolve_llm_from_bundle(bundle)


class ResolveCodeactConfigTests(unittest.TestCase):
    def _bundle(self, codeact: dict | None = None) -> TaskBundle:
        return TaskBundle(
            root=Path("/tmp/bundle"),
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


class ForbiddenPatternTests(unittest.TestCase):
    def test_scan_finds_pattern_in_py_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "main.py").write_text("import openctp\n", encoding="utf-8")
            hits = scan_forbidden_patterns(ws, ["openctp"])
            self.assertEqual(len(hits), 1)
            self.assertIn("openctp", hits[0])

    def test_scan_skips_venv(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            venv = ws / ".venv" / "lib"
            venv.mkdir(parents=True)
            (venv / "bad.py").write_text("openctp", encoding="utf-8")
            hits = scan_forbidden_patterns(ws, ["openctp"])
            self.assertEqual(hits, [])


class EmitLlmUsageTests(unittest.TestCase):
    def test_emit_llm_usage_reads_accumulated_token_usage(self) -> None:
        snapshot = MetricsSnapshot(
            accumulated_cost=0.012,
            accumulated_token_usage=TokenUsage(
                prompt_tokens=100,
                completion_tokens=50,
            ),
        )

        class FakeStats:
            def get_snapshot(self):
                return snapshot

        class FakeConversation:
            conversation_stats = type(
                "CS", (), {"get_combined_metrics": lambda self: FakeStats()}
            )()

        buf = StringIO()

        def capture(event: str, **kw: object) -> None:
            buf.write(json.dumps({"event": event, **kw}) + "\n")

        with patch("stagent_codeact.events.emit", capture):
            emit_llm_usage(FakeConversation())
        data = json.loads(buf.getvalue().strip())
        self.assertEqual(data["event"], "llm_usage")
        self.assertEqual(data["promptTokens"], 100)
        self.assertEqual(data["completionTokens"], 50)
        self.assertAlmostEqual(data["cost"], 0.012)


if __name__ == "__main__":
    unittest.main()
