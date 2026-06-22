"""Delivery gate checks before finish / sprint exit."""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from pydantic import BaseModel, Field

PLACEHOLDER_PATTERNS = (
    re.compile(r"请去\s*API\s*操作"),
    re.compile(r"功能已就绪"),
    re.compile(r"TODO:\s*implement", re.IGNORECASE),
    re.compile(r"NotImplementedError"),
)

E2E_CANDIDATES = (
    "scripts/e2e_smoke.sh",
    "scripts/acceptance.sh",
)


class DeliveryGateResult(BaseModel):
    passed: bool
    failures: list[str] = Field(default_factory=list)

    @property
    def message(self) -> str:
        if self.passed:
            return "Delivery gate passed."
        return "Delivery gate failed:\n- " + "\n- ".join(self.failures)


def is_delivery_workspace(working_dir: Path) -> bool:
    return (working_dir / "ACCEPTANCE.md").is_file()


def _load_tasks(working_dir: Path) -> list[dict]:
    path = working_dir / "TASKS.json"
    if not path.is_file():
        return []
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def _check_task_states(tasks: list[dict]) -> list[str]:
    failures: list[str] = []
    blocking = {"in_progress", "mock_done", "integration_done"}
    blocked = [t for t in tasks if t.get("status") in blocking]
    if blocked:
        ids = ", ".join(t.get("id") or t.get("title", "?") for t in blocked)
        failures.append(f"Incomplete TKs remain: {ids}")
    return failures


def _check_acceptance_md(working_dir: Path) -> list[str]:
    path = working_dir / "ACCEPTANCE.md"
    if not path.is_file():
        return []
    text = path.read_text(encoding="utf-8", errors="replace")
    if "Given" not in text and "When" not in text:
        failures = ["ACCEPTANCE.md exists but has no Given/When/Then entries"]
    else:
        failures = []
    if "验证命令" not in text and "Verification" not in text:
        failures.append(
            "ACCEPTANCE.md missing verification command/output section "
            "(验证命令 / Verification)"
        )
    return failures


def _grep_placeholders(working_dir: Path) -> list[str]:
    failures: list[str] = []
    scan_roots = ("backend", "frontend", "miniprogram", "src", ".")
    for root_name in scan_roots:
        root = working_dir / root_name
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix not in {
                ".py",
                ".ts",
                ".tsx",
                ".js",
                ".jsx",
                ".vue",
                ".go",
                ".java",
                ".md",
            }:
                continue
            if any(part.startswith(".") for part in path.parts):
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            for pattern in PLACEHOLDER_PATTERNS:
                if pattern.search(text):
                    rel = path.relative_to(working_dir)
                    failures.append(f"Placeholder pattern {pattern.pattern!r} in {rel}")
                    break
    return failures[:10]


def _run_e2e_script(working_dir: Path) -> list[str]:
    for rel in E2E_CANDIDATES:
        script = working_dir / rel
        if not script.is_file():
            continue
        try:
            proc = subprocess.run(
                ["bash", str(script)],
                cwd=working_dir,
                capture_output=True,
                text=True,
                timeout=300,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            return [f"{rel} failed to run: {exc}"]
        if proc.returncode != 0:
            tail = (proc.stdout + proc.stderr)[-2000:]
            return [f"{rel} exited {proc.returncode}:\n{tail}"]
        return []
    return []


def check_delivery_gate(
    working_dir: Path,
    *,
    run_e2e: bool = True,
    scan_placeholders: bool = True,
) -> DeliveryGateResult:
    """Run built-in delivery gate checks for a workspace."""
    working_dir = working_dir.resolve()
    failures: list[str] = []

    if not is_delivery_workspace(working_dir):
        return DeliveryGateResult(passed=True)

    failures.extend(_check_acceptance_md(working_dir))
    failures.extend(_check_task_states(_load_tasks(working_dir)))

    if scan_placeholders:
        failures.extend(_grep_placeholders(working_dir))

    if run_e2e:
        failures.extend(_run_e2e_script(working_dir))

    return DeliveryGateResult(passed=not failures, failures=failures)


def check_delivery_gate_tuple(working_dir: Path) -> tuple[bool, str]:
    """Backward-compatible tuple API used by hooks."""
    result = check_delivery_gate(Path(working_dir))
    if result.passed:
        return True, "Delivery gate passed."
    return False, result.message
