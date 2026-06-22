"""Validation rules for delivery-mode task tracker updates."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from openhands.tools.task_tracker.definition import TaskItem

TaskTrackerStatusType = Literal[
    "todo", "in_progress", "mock_done", "integration_done", "done"
]

# Allowed forward transitions in delivery mode.
_STATUS_TRANSITIONS: dict[str, set[str]] = {
    "todo": {"in_progress"},
    "in_progress": {"mock_done", "todo"},
    "mock_done": {"integration_done", "in_progress"},
    "integration_done": {"done", "in_progress"},
    "done": set(),
}

def _is_leaf_in(tasks: list[TaskItem], task: TaskItem) -> bool:
    return not any(other.parent_id == task.id for other in tasks)


def normalize_task_list(tasks: list[TaskItem]) -> list[TaskItem]:
    """Assign ids to legacy tasks and return a normalized copy."""
    normalized: list[TaskItem] = []
    for index, task in enumerate(tasks):
        data = task.model_dump()
        data["id"] = _normalize_id(task, index)
        normalized.append(type(task).model_validate(data))
    return normalized


def validate_task_plan(
    tasks: list[TaskItem],
    *,
    delivery_mode: bool,
    previous: list[TaskItem] | None = None,
) -> tuple[list[TaskItem], list[str]]:
    """Validate and normalize a planned task list. Returns (tasks, errors)."""
    errors: list[str] = []
    normalized = normalize_task_list(tasks)
    previous_by_id = {t.id: t for t in normalize_task_list(previous or [])}

    in_progress_leaves = [
        t
        for t in normalized
        if t.status == "in_progress" and _is_leaf_in(normalized, t)
    ]
    if delivery_mode and len(in_progress_leaves) > 1:
        errors.append(
            "Delivery mode allows only one in_progress leaf TK; found "
            f"{len(in_progress_leaves)}: "
            + ", ".join(t.id for t in in_progress_leaves)
        )

    for task in normalized:
        prev = previous_by_id.get(task.id)
        if prev and prev.status != task.status:
            if delivery_mode and not _status_transition_allowed(prev.status, task.status):
                errors.append(
                    f"{task.id}: invalid status transition "
                    f"{prev.status!r} -> {task.status!r}. "
                    "Use mock_done -> integration_done -> done."
                )

        if task.status == "done":
            if delivery_mode and prev and prev.status not in (
                "integration_done",
                "done",
            ):
                errors.append(
                    f"{task.id}: cannot mark done without integration_done "
                    f"(current transition from {prev.status!r})."
                )
            unmet = [
                dep
                for dep in task.depends_on
                if _status_of(normalized, dep) != "done"
            ]
            if unmet:
                errors.append(
                    f"{task.id}: depends_on not satisfied: {', '.join(unmet)}"
                )

    if errors:
        return normalized, errors
    return normalized, []


def _normalize_id(task: TaskItem, index: int) -> str:
    if task.id:
        return task.id
    return f"TK-{index + 1:03d}"


def _is_leaf_in(tasks: list[TaskItem], task: TaskItem) -> bool:
    return not any(other.parent_id == task.id for other in tasks)


def _status_of(tasks: list[TaskItem], task_id: str) -> str | None:
    for task in tasks:
        if task.id == task_id:
            return task.status
    return None


def _status_transition_allowed(old: str, new: str) -> bool:
    if old == new:
        return True
    allowed = _STATUS_TRANSITIONS.get(old, set())
    return new in allowed
