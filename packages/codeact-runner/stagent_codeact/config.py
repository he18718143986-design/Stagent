"""Resolve CodeAct runtime options from TaskBundle."""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from typing import Any

from .bundle import TaskBundle


DEFAULT_MAX_STEPS = 80
DEFAULT_TIMEOUT_MS = 2_400_000  # 40 minutes


@dataclass(frozen=True)
class CodeActRuntimeConfig:
    max_steps: int
    timeout_ms: int
    enable_browser: bool
    forbidden_patterns: tuple[str, ...]


def resolve_codeact_config(bundle: TaskBundle) -> CodeActRuntimeConfig:
    raw: dict[str, Any] = bundle.codeact_config
    max_steps = int(raw.get("maxSteps", DEFAULT_MAX_STEPS))
    timeout_ms = int(raw.get("timeoutMs", DEFAULT_TIMEOUT_MS))
    enable_browser = bool(raw.get("enableBrowser", False))
    patterns = raw.get("forbiddenPatterns") or []
    forbidden = tuple(str(p) for p in patterns if p)

    if max_steps < 1:
        raise ValueError(f"codeact.maxSteps must be >= 1, got {max_steps}")
    if timeout_ms < 1:
        raise ValueError(f"codeact.timeoutMs must be >= 1, got {timeout_ms}")

    return CodeActRuntimeConfig(
        max_steps=max_steps,
        timeout_ms=timeout_ms,
        enable_browser=enable_browser,
        forbidden_patterns=forbidden,
    )


def require_tmux() -> None:
    if shutil.which("tmux") is None:
        raise EnvironmentError(
            "tmux is required for TerminalTool. Install tmux (e.g. apt install tmux / brew install tmux)."
        )
