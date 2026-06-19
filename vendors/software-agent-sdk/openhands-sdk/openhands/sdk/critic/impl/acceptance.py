"""
AcceptanceCritic — validates delivery gate criteria before finish.

Used with iterative_refinement to retry when gate checks fail (max 5 rounds).
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import TYPE_CHECKING

from openhands.sdk.critic.base import CriticBase, CriticResult, IterativeRefinementConfig
from openhands.sdk.delivery.gate import check_delivery_gate, is_delivery_workspace
from openhands.sdk.logger import get_logger


if TYPE_CHECKING:
    from openhands.sdk.event.base import LLMConvertibleEvent


logger = get_logger(__name__)


class AcceptanceCritic(CriticBase):
    """Critic that runs delivery gate checks against the agent workspace."""

    working_dir: str = "."
    run_e2e: bool = True

    def evaluate(
        self,
        events: Sequence["LLMConvertibleEvent"],
        git_patch: str | None = None,  # noqa: ARG002
    ) -> CriticResult:
        workspace = Path(self.working_dir)
        if not is_delivery_workspace(workspace):
            return CriticResult(
                score=1.0,
                message="No ACCEPTANCE.md — delivery gate skipped.",
            )

        result = check_delivery_gate(workspace, run_e2e=self.run_e2e)
        if result.passed:
            return CriticResult(score=1.0, message=result.message)

        logger.debug("AcceptanceCritic failed: %s", result.failures)
        return CriticResult(score=0.0, message=result.message)

    def get_followup_prompt(self, critic_result: CriticResult, iteration: int) -> str:
        return (
            f"Delivery gate failed (iteration {iteration}). "
            "Fix every item below before calling finish again:\n\n"
            f"{critic_result.message}\n\n"
            "Update TK status via task_tracker (mock_done -> integration_done -> done) "
            "only after real verification passes."
        )

    @classmethod
    def for_workspace(
        cls,
        working_dir: str | Path,
        *,
        max_iterations: int = 5,
        run_e2e: bool = True,
    ) -> AcceptanceCritic:
        """Factory with default 5-round iterative refinement."""
        return cls(
            working_dir=str(working_dir),
            run_e2e=run_e2e,
            iterative_refinement=IterativeRefinementConfig(
                success_threshold=1.0,
                max_iterations=max_iterations,
            ),
        )
