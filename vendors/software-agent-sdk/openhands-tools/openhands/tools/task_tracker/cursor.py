"""CURSOR.json read/write for delivery sprint state."""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, Field


CURSOR_FILENAME = "CURSOR.json"


class DeliveryCursor(BaseModel):
    """Tracks current delivery phase, sprint, and active batch."""

    phase: str = Field(default="0", description="Current delivery phase (0-6).")
    sprint: int = Field(default=1, ge=1, description="Current sprint number.")
    batch_id: str = Field(default="", description="Active batch id, e.g. batch-001.")
    in_progress_tk_ids: list[str] = Field(
        default_factory=list,
        description="Leaf TK ids currently in the active batch.",
    )


def cursor_path(working_dir: Path) -> Path:
    return working_dir / CURSOR_FILENAME


def load_cursor(working_dir: Path) -> DeliveryCursor | None:
    path = cursor_path(working_dir)
    if not path.is_file():
        return None
    try:
        with open(path, encoding="utf-8") as handle:
            return DeliveryCursor.model_validate(json.load(handle))
    except (OSError, json.JSONDecodeError, ValueError):
        return None


def save_cursor(working_dir: Path, cursor: DeliveryCursor) -> None:
    path = cursor_path(working_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(cursor.model_dump(), handle, indent=2)


def is_delivery_workspace(working_dir: Path) -> bool:
    """True when the workspace has delivery pipeline artifacts."""
    return (working_dir / "ACCEPTANCE.md").is_file()
