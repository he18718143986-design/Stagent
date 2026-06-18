"""Unit tests for stagent_codeact (L0 — no LLM calls)."""

from __future__ import annotations

import json
import tempfile
import unittest
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from stagent_codeact.bundle import load_bundle, resolve_llm_from_bundle
from stagent_codeact.events import emit_llm_usage, scan_forbidden_patterns
from stagent_codeact.protocol import emit
from openhands.sdk.llm.utils.metrics import MetricsSnapshot, TokenUsage


class ProtocolTests(unittest.TestCase):
    def test_emit_ndjson(self) -> None:
        buf = StringIO()
        with patch("stagent_codeact.protocol.sys.stdout", buf):
            emit("runner_start", taskId="t1")
        line = buf.getvalue().strip()
        data = json.loads(line)
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
            conversation_stats = type("CS", (), {"get_combined_metrics": lambda self: FakeStats()})()

        buf = StringIO()
        with patch("stagent_codeact.events.emit", lambda event, **kw: buf.write(json.dumps({"event": event, **kw}) + "\n")):
            emit_llm_usage(FakeConversation())
        data = json.loads(buf.getvalue().strip())
        self.assertEqual(data["event"], "llm_usage")
        self.assertEqual(data["promptTokens"], 100)
        self.assertEqual(data["completionTokens"], 50)
        self.assertAlmostEqual(data["cost"], 0.012)


if __name__ == "__main__":
    unittest.main()
