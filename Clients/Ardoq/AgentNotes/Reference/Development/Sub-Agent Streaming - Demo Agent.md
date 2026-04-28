---
tags: [sub-agent, streaming, nested, pydantic-ai, reference]
type: reference
---

# Sub-Agent Streaming — Demo Agent

A working two-agent demo that exercises the nested streaming boundary. Use this as a reference implementation when you need to wire up a parent agent that calls a child agent via `run_completion_streaming_events`.

## Key mechanics

- Inner agent (`word_count_agent`) is invoked via `run_completion_streaming_events` inside a tool body
- The generator is **drained to completion** — intermediate delta events are consumed silently because they cannot propagate through the tool boundary
- The inner result is captured in `parent_result.sub_agents["word_count_agent"]` via the ContextVar mechanism in `ardoq_ai.completion.span_context`
- Breaking the drain loop early would leave the generator open and delay `reset_agent_context()` in the finally block

## Original locations

- `libs/ardoq_ai/ardoq_ai/agents/nested_demo/agent.py`

## Restore instructions

To bring this back: recreate the file at `libs/ardoq_ai/ardoq_ai/agents/nested_demo/agent.py` with the content below. The `nested_demo` directory will need an `__init__.py` (empty) alongside it.

## Code

```python
"""Nested demo agents for testing layered streaming behaviour.

Two agents:
  - ``word_count_agent``   — inner/child agent; counts words and summarises text.
  - ``nested_demo_agent``  — outer/parent agent; calls the inner agent as a tool.

The inner agent is also invoked via ``run_completion_streaming_events`` (streaming).
It is drained to completion inside the tool body — intermediate delta events are
consumed silently because they cannot propagate through the tool boundary.  The
``report_to_parent`` call inside the generator still fires, so the inner result is
captured in ``parent_result.sub_agents["word_count_agent"]`` via the ContextVar
mechanism in ``ardoq_ai.completion.span_context``.
"""

from typing import Any

import loguru
from pydantic import BaseModel, ConfigDict
from pydantic_ai import Agent, RunContext

from ardoq_ai.completion.schemas.message import Message
from ardoq_ai.completion.schemas.result import CompletionFailure, CompletionSuccess
from ardoq_ai.completion.streaming import run_completion_streaming_events
from ardoq_ai.config.deployments import get_default_deployment, get_model_settings

# ---------------------------------------------------------------------------
# Inner agent — word_count_agent
# ---------------------------------------------------------------------------


class WordCountAgentDependencies(BaseModel):
    pass


word_count_agent = Agent(
    name="word_count_agent",
    deps_type=WordCountAgentDependencies,
    tools=[],
    output_type=str,
    system_prompt=(
        "You are a concise text analyser. "
        "Given a piece of text, reply with a single short paragraph that states: "
        "(1) the word count, (2) the dominant topic in one sentence, "
        "(3) the overall sentiment (positive / neutral / negative). "
        "Keep the whole answer under 60 words."
    ),
    model_settings=get_model_settings(get_default_deployment()),
    retries=2,
)


# ---------------------------------------------------------------------------
# Outer agent — nested_demo_agent
# ---------------------------------------------------------------------------


class NestedDemoAgentDependencies(BaseModel):
    """Dependencies for the outer demo agent.

    ``model`` and ``logger`` are runtime objects that pydantic cannot serialise,
    so we allow arbitrary types and exclude them from JSON output.
    """

    model: Any  # pydantic_ai.models.Model — not importable at type-check time as a runtime type
    logger: Any  # loguru.Logger — only exists as a stub at runtime

    model_config = ConfigDict(arbitrary_types_allowed=True)


nested_demo_agent = Agent(
    name="nested_demo_agent",
    deps_type=NestedDemoAgentDependencies,
    output_type=str,
    system_prompt=(
        "You are a demonstration agent that showcases nested agent behaviour. "
        "When asked to analyse text, always use the ``analyse_text`` tool to delegate "
        "the actual analysis to a sub-agent, then return a friendly summary of what the "
        "sub-agent found. Do not analyse the text yourself."
    ),
    model_settings=get_model_settings(get_default_deployment()),
    retries=2,
)


@nested_demo_agent.tool
async def analyse_text(ctx: RunContext[NestedDemoAgentDependencies], text: str) -> str:
    """Delegate text analysis to the word_count_agent sub-agent.

    Args:
        ctx: Run context carrying the model and logger from the parent agent.
        text: The text to analyse.

    Returns:
        The sub-agent's analysis as a plain string, or an error description on failure.
    """
    logger: loguru.Logger = ctx.deps.logger
    logger.debug(f"[nested_demo_agent] Delegating to word_count_agent — text length: {len(text)}")

    # run_completion_streaming_events is an async generator — call without await,
    # then drain it to completion.  Breaking early would leave the generator open
    # and delay the reset_agent_context() call in its finally block.
    events = run_completion_streaming_events(
        new_message=Message(role="user", content=text),
        agent=word_count_agent,
        model=ctx.deps.model,
        logger=logger,
        dependencies=WordCountAgentDependencies(),
    )

    final: CompletionSuccess[str] | CompletionFailure | None = None
    async for event in events:
        logger.debug(f"Getting even in sub-agent: {event.model_dump()}")
        if isinstance(event, (CompletionSuccess, CompletionFailure)):
            final = event  # always the last item; keep draining (generator ends here anyway)

    match final:
        case CompletionSuccess():
            logger.debug(f"[nested_demo_agent] word_count_agent succeeded: {final.output[:80]}…")
            return final.output
        case CompletionFailure():
            logger.warning(f"[nested_demo_agent] word_count_agent failed: {final.error.message}")
            return f"Sub-agent failed: {final.error.message}"
        case None:
            logger.error("[nested_demo_agent] word_count_agent stream ended without a result")
            return "Sub-agent produced no output"
```

## Related

- [[Clients/Ardoq/AgentNotes/Reference/Development/Sub-Agent Streaming - Test Suite]]
- [[Clients/Ardoq/AgentNotes/Reference/Development/Sub-Agent Streaming - Stream Visualizer]]
- [[Clients/Ardoq/AgentNotes/Active/2026-04-27 Streaming nested sub-agent events to end user]]
