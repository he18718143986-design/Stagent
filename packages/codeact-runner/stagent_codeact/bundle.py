"""Load .stagent-bundle task descriptor and prompt files."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class TaskBundle:
    root: Path
    task: dict[str, Any]
    prompt_text: str

    @property
    def task_id(self) -> str:
        return str(self.task.get("taskId", "unknown"))

    @property
    def codeact_config(self) -> dict[str, Any]:
        return dict(self.task.get("codeact") or {})

    @property
    def llm_config(self) -> dict[str, Any]:
        return dict(self.task.get("llm") or {})


def load_bundle(bundle_dir: str | Path) -> TaskBundle:
    root = Path(bundle_dir).resolve()
    task_path = root / "task.json"
    if not task_path.is_file():
        raise FileNotFoundError(f"Missing task.json in bundle: {root}")

    with task_path.open(encoding="utf-8") as f:
        task = json.load(f)

    prompt_path = root / "OPENHANDS_PROMPT.md"
    if prompt_path.is_file():
        prompt_text = prompt_path.read_text(encoding="utf-8")
    else:
        prompt_text = ""

    spec_refs = task.get("specRefs") or []
    for ref in spec_refs:
        spec_path = root / ref
        if spec_path.is_file():
            prompt_text += f"\n\n---\n# Spec: {ref}\n\n"
            prompt_text += spec_path.read_text(encoding="utf-8")

    return TaskBundle(root=root, task=task, prompt_text=prompt_text.strip())


def resolve_llm_from_bundle(bundle: TaskBundle) -> dict[str, Any]:
    """Map bundle llm block + env to openhands.sdk.LLM kwargs."""
    cfg = bundle.llm_config
    api_key_env = cfg.get("apiKeyEnv") or "DEEPSEEK_API_KEY"
    api_key = os.environ.get(api_key_env) or os.environ.get("LLM_API_KEY")
    if not api_key:
        raise EnvironmentError(
            f"Missing API key: set {api_key_env} or LLM_API_KEY"
        )

    model = (
        os.environ.get("LLM_MODEL")
        or cfg.get("model", "").replace("${LLM_MODEL}", "")
        or "deepseek/deepseek-chat"
    )
    base_url = os.environ.get("LLM_BASE_URL") or cfg.get("baseUrl")
    if base_url and isinstance(base_url, str):
        base_url = base_url.replace("${LLM_BASE_URL}", "")
        if base_url and not base_url.startswith("${"):
            pass
        else:
            base_url = os.environ.get("LLM_BASE_URL")

    llm_kwargs: dict[str, Any] = {"model": model, "api_key": api_key}
    if base_url:
        llm_kwargs["base_url"] = base_url
    return llm_kwargs
