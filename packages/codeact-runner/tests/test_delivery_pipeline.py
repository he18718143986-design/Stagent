"""Tests for OpenHands delivery pipeline Phase 1 (vendored SDK)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from openhands.sdk.delivery.gate import check_delivery_gate, is_delivery_workspace
from openhands.tools.task_tracker.definition import TaskItem, TaskTrackerExecutor
from openhands.tools.task_tracker.validation import validate_task_plan


class TaskValidationTests(unittest.TestCase):
    def test_rejects_direct_todo_to_done_in_delivery_mode(self) -> None:
        tasks = [
            TaskItem(title="Implement API", status="todo"),
        ]
        planned = [TaskItem(title="Implement API", status="done")]
        _, errors = validate_task_plan(
            planned,
            delivery_mode=True,
            previous=tasks,
        )
        self.assertTrue(any("invalid status transition" in e for e in errors))

    def test_allows_mock_to_integration_to_done(self) -> None:
        previous = [
            TaskItem(id="ACC-1", title="Feature", status="mock_done"),
        ]
        planned = [
            TaskItem(id="ACC-1", title="Feature", status="integration_done"),
        ]
        normalized, errors = validate_task_plan(
            planned,
            delivery_mode=True,
            previous=previous,
        )
        self.assertEqual(errors, [])
        self.assertEqual(normalized[0].status, "integration_done")

    def test_rejects_multiple_in_progress_leaves(self) -> None:
        planned = [
            TaskItem(id="A", title="One", status="in_progress"),
            TaskItem(id="B", title="Two", status="in_progress"),
        ]
        _, errors = validate_task_plan(planned, delivery_mode=True)
        self.assertTrue(any("only one in_progress leaf" in e for e in errors))


class TaskTrackerExecutorTests(unittest.TestCase):
    def test_persists_extended_fields_to_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "ACCEPTANCE.md").write_text(
                "Given user\nWhen action\nThen result\n",
                encoding="utf-8",
            )
            executor = TaskTrackerExecutor(workspace_dir=str(ws))
            from openhands.tools.task_tracker.definition import TaskTrackerAction

            action = TaskTrackerAction(
                command="plan",
                task_list=[
                    TaskItem(
                        id="ACC-1",
                        title="Login",
                        status="in_progress",
                        acceptance=["Given user When login Then 200"],
                        phase="1",
                    )
                ],
            )
            result = executor(action)
            self.assertFalse(result.is_error)
            saved = json.loads((ws / "TASKS.json").read_text(encoding="utf-8"))
            self.assertEqual(saved[0]["id"], "ACC-1")
            self.assertEqual(saved[0]["acceptance"], ["Given user When login Then 200"])


class DeliveryGateTests(unittest.TestCase):
    def test_skips_non_delivery_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            result = check_delivery_gate(ws, run_e2e=False, scan_placeholders=False)
            self.assertTrue(result.passed)

    def test_blocks_incomplete_tasks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "ACCEPTANCE.md").write_text(
                "Given x\nWhen y\nThen z\nVerification: pytest\n",
                encoding="utf-8",
            )
            (ws / "TASKS.json").write_text(
                json.dumps(
                    [{"id": "ACC-1", "title": "T", "status": "in_progress"}]
                ),
                encoding="utf-8",
            )
            self.assertTrue(is_delivery_workspace(ws))
            result = check_delivery_gate(ws, run_e2e=False, scan_placeholders=False)
            self.assertFalse(result.passed)
            self.assertTrue(any("Incomplete TKs" in f for f in result.failures))

    def test_passes_when_all_tasks_done(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "ACCEPTANCE.md").write_text(
                "Given x\nWhen y\nThen z\nVerification: ok\n",
                encoding="utf-8",
            )
            (ws / "TASKS.json").write_text(
                json.dumps([{"id": "ACC-1", "title": "T", "status": "done"}]),
                encoding="utf-8",
            )
            result = check_delivery_gate(ws, run_e2e=False, scan_placeholders=False)
            self.assertTrue(result.passed)


if __name__ == "__main__":
    unittest.main()
