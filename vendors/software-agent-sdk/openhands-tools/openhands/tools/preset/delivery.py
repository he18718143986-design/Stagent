"""Delivery preset — task tree + scheduler-ready tools (Phase 1 subset)."""

from openhands.sdk import Agent, LLM
from openhands.sdk.context.condenser import default_condenser
from openhands.sdk.context.condenser.base import CondenserBase
from openhands.sdk.logger import get_logger
from openhands.sdk.tool import Tool
from openhands.tools.preset.default import register_builtins_agents, register_default_tools


logger = get_logger(__name__)

DELIVERY_SYSTEM_SUFFIX = """
You are in DELIVERY mode. Follow these rules strictly:
- Use task_tracker with TK ids, depends_on, and acceptance criteria.
- Progress each leaf TK: in_progress -> mock_done -> integration_done -> done.
- Never call finish until all batch TKs are done and e2e/acceptance scripts pass.
- Do not mark done while tests are failing or placeholders remain in code.
"""


def get_delivery_tools(
    enable_browser: bool = True,
    enable_sub_agents: bool = True,
) -> list[Tool]:
    """Tool preset for acceptance-driven delivery workflows."""
    register_default_tools(enable_browser=enable_browser)

    from openhands.tools.file_editor import FileEditorTool
    from openhands.tools.task_tracker import TaskTrackerTool
    from openhands.tools.terminal import TerminalTool

    tools = [
        Tool(name=TerminalTool.name),
        Tool(name=FileEditorTool.name),
        Tool(name=TaskTrackerTool.name),
    ]
    if enable_browser:
        from openhands.tools.browser_use import BrowserToolSet

        tools.append(Tool(name=BrowserToolSet.name))
    if enable_sub_agents:
        from openhands.tools.task import TaskToolSet

        tools.append(Tool(name=TaskToolSet.name))
    return tools


def get_delivery_condenser(llm: LLM) -> CondenserBase:
    return default_condenser(llm)


def get_delivery_agent(
    llm: LLM,
    *,
    enable_browser: bool = True,
    enable_sub_agents: bool = True,
    working_dir: str | None = None,
) -> Agent:
    """Agent configured for delivery mode with optional AcceptanceCritic."""
    from openhands.sdk.critic.impl.acceptance import AcceptanceCritic

    tools = get_delivery_tools(
        enable_browser=enable_browser,
        enable_sub_agents=enable_sub_agents,
    )
    critic = None
    if working_dir:
        critic = AcceptanceCritic.for_workspace(working_dir)

    return Agent(
        llm=llm,
        tools=tools,
        critic=critic,
        system_prompt_kwargs={"delivery_mode": True},
        condenser=get_delivery_condenser(
            llm=llm.model_copy(update={"usage_id": "condenser"})
        ),
    )


def register_delivery_agents(enable_browser: bool = True) -> list[str]:
    """Register builtin sub-agents for delivery workflows."""
    return register_builtins_agents(enable_browser=enable_browser)
