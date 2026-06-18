"""Run CodeAct conversation against a workspace using vendored openhands-sdk."""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any

from openhands.sdk import LLM, Agent, Conversation
from openhands.tools.preset.default import get_default_tools

from .bundle import TaskBundle, load_bundle, resolve_llm_from_bundle
from .config import CodeActRuntimeConfig, require_tmux, resolve_codeact_config
from .events import SdkEventBridge, make_sdk_callback
from .protocol import emit, emit_runner_done, emit_runner_failed


def _build_agent(llm_kwargs: dict[str, Any], *, enable_browser: bool) -> Agent:
    return Agent(
        llm=LLM(**llm_kwargs),
        tools=get_default_tools(enable_browser=enable_browser),
    )


def _compose_user_message(bundle: TaskBundle, fix_prompt: str | None) -> str:
    parts: list[str] = []
    if bundle.prompt_text:
        parts.append(bundle.prompt_text)
    if fix_prompt:
        parts.append("\n\n---\n# Gate 回流修复\n\n" + fix_prompt.strip())
    if not parts:
        raise ValueError("Bundle has no OPENHANDS_PROMPT.md or specRefs content")
    parts.append(
        "\n\n---\n# 交付纪律\n\n"
        "- 不得修改 tests/ 与 scripts/acceptance.sh 的断言语义\n"
        "- 不得自判交付完成；Stagent Gate 为唯一裁判\n"
        "- fixture CSV 须落盘并在 config 默认路径可运行\n"
    )
    cfg = resolve_codeact_config(bundle)
    if cfg.forbidden_patterns:
        joined = "、".join(cfg.forbidden_patterns)
        parts.append(f"- 禁止在实现中引入或使用：{joined}\n")
    return "\n".join(parts)


def _run_conversation(
    conversation: Conversation,
    user_message: str,
    timeout_sec: float,
    bridge: SdkEventBridge,
) -> str:
    """Run conversation.run() with optional wall-clock timeout. Returns done reason."""
    result: dict[str, Any] = {"exc": None}

    def target() -> None:
        try:
            conversation.send_message(user_message)
            conversation.run()
        except Exception as exc:  # noqa: BLE001 — surfaced to caller
            result["exc"] = exc

    if timeout_sec <= 0:
        target()
    else:
        thread = threading.Thread(target=target, daemon=True)
        thread.start()
        thread.join(timeout=timeout_sec)
        if thread.is_alive():
            return "timeout"

    if result["exc"] is not None:
        raise result["exc"]

    if bridge.max_iterations_reached:
        return "max_steps"
    return "completed"


def run_codeact(
    bundle_dir: str | Path,
    workspace: str | Path,
    *,
    fix_prompt: str | None = None,
) -> int:
    """Execute one CodeAct session. Returns process exit code (0 = ran, not Gate pass)."""
    bundle = load_bundle(bundle_dir)
    ws = Path(workspace).resolve()
    if not ws.is_dir():
        emit_runner_failed(f"Workspace not found: {ws}", retryable=False)
        return 1

    try:
        runtime = resolve_codeact_config(bundle)
    except ValueError as e:
        emit_runner_failed(str(e), retryable=False)
        return 1

    emit(
        "runner_start",
        taskId=bundle.task_id,
        workspace=str(ws),
        maxSteps=runtime.max_steps,
        timeoutMs=runtime.timeout_ms,
        enableBrowser=runtime.enable_browser,
    )

    try:
        require_tmux()
        llm_kwargs = resolve_llm_from_bundle(bundle)
    except EnvironmentError as e:
        emit_runner_failed(str(e), retryable=False)
        return 1

    try:
        user_message = _compose_user_message(bundle, fix_prompt)
    except ValueError as e:
        emit_runner_failed(str(e), retryable=False)
        return 1

    os.chdir(ws)
    bridge = make_sdk_callback()
    agent = _build_agent(llm_kwargs, enable_browser=runtime.enable_browser)
    conversation = Conversation(
        agent=agent,
        workspace=str(ws),
        max_iteration_per_run=runtime.max_steps,
        callbacks=[bridge],
        visualizer=None,
    )

    timeout_sec = runtime.timeout_ms / 1000.0
    emit("step_start", phase="conversation", maxSteps=runtime.max_steps, timeoutMs=runtime.timeout_ms)
    try:
        reason = _run_conversation(conversation, user_message, timeout_sec, bridge)
    except Exception as e:
        emit_runner_failed(str(e), retryable=True)
        return 1
    finally:
        emit(
            "step_end",
            phase="conversation",
            actions=bridge.action_count,
            observations=bridge.observation_count,
        )

    emit_runner_done(
        reason,
        taskId=bundle.task_id,
        actions=bridge.action_count,
        observations=bridge.observation_count,
        maxSteps=runtime.max_steps,
    )
    if reason == "timeout":
        return 2
    if reason == "max_steps":
        return 3
    return 0
