"""Run CodeAct conversation against a workspace using vendored openhands-sdk."""

from __future__ import annotations

import concurrent.futures
import os
from pathlib import Path
from typing import Any

from openhands.sdk import LLM, Agent, Conversation, Tool
from openhands.tools.file_editor import FileEditorTool
from openhands.tools.task_tracker import TaskTrackerTool
from openhands.tools.terminal import TerminalTool

from .bundle import TaskBundle, load_bundle, resolve_llm_from_bundle
from .events import emit_llm_usage, make_event_callback, scan_forbidden_patterns
from .protocol import emit, emit_runner_done, emit_runner_failed


def _build_agent(llm_kwargs: dict) -> Agent:
    return Agent(
        llm=LLM(**llm_kwargs),
        tools=[
            Tool(name=TerminalTool.name),
            Tool(name=FileEditorTool.name),
            Tool(name=TaskTrackerTool.name),
        ],
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
    forbidden = bundle.codeact_config.get("forbiddenPatterns") or []
    if forbidden:
        parts.append(
            "\n- 禁止在代码/requirements 中出现："
            + ", ".join(str(p) for p in forbidden)
        )
    return "\n".join(parts)


def _run_conversation(conversation: Conversation) -> None:
    conversation.run()


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

    codeact_cfg = bundle.codeact_config
    max_steps = int(codeact_cfg.get("maxSteps") or 80)
    timeout_ms = int(codeact_cfg.get("timeoutMs") or 0)
    timeout_sec = timeout_ms / 1000.0 if timeout_ms > 0 else None

    emit(
        "runner_start",
        taskId=bundle.task_id,
        workspace=str(ws),
        maxSteps=max_steps,
        timeoutMs=timeout_ms or None,
    )

    try:
        llm_kwargs = resolve_llm_from_bundle(bundle)
    except EnvironmentError as e:
        emit_runner_failed(str(e), retryable=False)
        return 1

    try:
        user_message = _compose_user_message(bundle, fix_prompt)
    except ValueError as e:
        emit_runner_failed(str(e), retryable=False)
        return 1

    enable_browser = bool(codeact_cfg.get("enableBrowser", False))
    if enable_browser:
        emit(
            "runner_warning",
            message="enableBrowser=true not yet wired; using terminal+file_editor only",
        )

    run_state: dict[str, Any] = {"exit_reason": None}
    os.chdir(ws)
    agent = _build_agent(llm_kwargs)
    conversation = Conversation(
        agent=agent,
        workspace=str(ws),
        callbacks=[make_event_callback(run_state)],
        max_iteration_per_run=max_steps,
    )

    emit("step_start", phase="conversation")
    try:
        conversation.send_message(user_message)
        if timeout_sec:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                fut = pool.submit(_run_conversation, conversation)
                try:
                    fut.result(timeout=timeout_sec)
                except concurrent.futures.TimeoutError:
                    run_state["exit_reason"] = "timeout"
                    emit_runner_done("timeout", taskId=bundle.task_id)
                    emit_llm_usage(conversation)
                    return 1
        else:
            _run_conversation(conversation)
    except Exception as e:
        emit_runner_failed(str(e), retryable=True)
        emit_llm_usage(conversation)
        return 1
    finally:
        emit("step_end", phase="conversation")

    emit_llm_usage(conversation)

    forbidden_hits = scan_forbidden_patterns(
        ws, list(codeact_cfg.get("forbiddenPatterns") or [])
    )
    if forbidden_hits:
        emit("runner_warning", forbiddenPatterns=forbidden_hits[:20])
        emit_runner_failed(
            "Forbidden patterns detected: " + "; ".join(forbidden_hits[:5]),
            retryable=True,
        )
        return 1

    reason = run_state.get("exit_reason") or "completed"
    if reason == "max_steps":
        emit_runner_done("max_steps", taskId=bundle.task_id)
        return 0

    emit_runner_done(reason if reason in {"completed", "timeout", "error"} else "completed", taskId=bundle.task_id)
    return 0
