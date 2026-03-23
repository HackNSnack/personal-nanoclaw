# Simplify Dynamic Agent Return

**Created**: 2026-03-23
**Status**: in-progress
**Branch**: `AI-dynamically-return-agents`

## Context
PR feedback: the current branch turns every agent into a factory function (`get_X_agent()`) with repeated boilerplate — `if system_prompt` branching, `effective_deployment` resolution, duplicated `Agent(...)` constructors. The reviewer wants agents to stay simple/declarative and push the "magic" into shared infrastructure.

## Problem (current branch)
Each agent file now has:
1. An `if system_prompt is not None:` branch duplicating the entire `Agent(...)` call
2. `effective_deployment = deployment if deployment is not None else Deployment.CLAUDE_SONNET`
3. A nested `@agent.instructions` closure for the else-branch
4. ~30 lines of identical scaffolding per agent

## Solution: Use `agent.override(instructions=...)` from pydantic-ai

### Key discovery
pydantic-ai's `Agent` already supports everything needed at runtime:
- `agent.override(instructions=...)` — **full replacement** of agent instructions (uses `ContextVar`, async-safe)
- `agent.run(..., model_settings=...)` — **merged** with agent defaults, runtime takes priority

Source: `pydantic_ai/agent/__init__.py` lines 876-955, `_get_instructions` at 1513-1535.

### Plan

#### 1. Revert agents to module-level singletons
```python
# e.g. dashboard_agent/agent.py
dashboard_agent = Agent(
    name="dashboard_agent",
    deps_type=DashboardAgentDependencies,
    tools=[...],
    output_type=DashboardAgentOutput,
    model_settings=get_model_settings(Deployment.CLAUDE_SONNET),
    retries=2,
)

@dashboard_agent.instructions
def get_prompt(ctx: RunContext[DashboardAgentDependencies]) -> str:
    return DEFAULT_DASHBOARD_PROMPT_TEMPLATE.format(dashboard_id=ctx.deps.dashboard_id)
```
No factory function. No branching. Prompt files (`prompt.py`) can stay.

#### 2. Add `instructions` + `model_settings` params to completion functions
In `completion/non_streaming.py` and `completion/streaming.py`:
```python
async def run_completion(
    ...,
    instructions: str | None = None,
    model_settings: ModelSettings | None = None,
) -> ...:
    async def _run():
        return await agent.run(
            ..., model_settings=model_settings,
        )

    if instructions is not None:
        with agent.override(instructions=instructions):
            agent_result = await _run()
    else:
        agent_result = await _run()
```

#### 3. Resolve overrides once in dispatch layer
In `streaming_utils.py` / `non_streaming_utils.py`:
```python
override_instructions = request.system_prompt
override_settings = (
    get_model_settings(resolve_deployment(request.model))
    if request.model is not None
    else None
)

case DashboardAgentRequest():
    return run_completion_streaming_events(
        agent=dashboard_agent,
        dependencies=dependencies,
        instructions=override_instructions,
        model_settings=override_settings,
        **completion_params,
    )
```

### Files to change
| File | What |
|---|---|
| `agents/*/agent.py` (5 files) | Revert to singletons with `@agent.instructions` |
| `completion/non_streaming.py` | Add `instructions` + `model_settings`, use `agent.override()` |
| `completion/streaming.py` | Same |
| `streaming_utils.py` | Resolve overrides once, pass through |
| `non_streaming_utils.py` | Same |
| Factory tests | Rewrite to test `override()` behavior |

### Important detail: override vs append
- `agent.run(instructions=...)` — **appends** to agent's built-in instructions
- `agent.override(instructions=...)` — **replaces** agent's built-in instructions entirely
- We want **replace** behavior when a custom system prompt is provided → use `override()`
