---
tags: [ai-1300, timeout, pydantic-ai, pr-review, architecture]
type: work
status: in-progress
---

# AI-1300 PR #1230 — Agent Run Timeout Analysis

Deep-dive on PR #1230 (`AI-1300-agent-run-timeout`): can `ModelSettings(timeout=...)` and/or pydantic-ai's per-tool `timeout` replace the PR's custom `asyncio.timeout` approach? And is the PR's implementation the cleanest way to achieve a global run timeout?

## Problem

pydantic-ai has no native wall-clock timeout for an entire agent run. `UsageLimits` caps iterations/tokens but not time. A slow/hung LLM request or tool call can block indefinitely. The PR wants a single wall-clock ceiling that starts at request entry and kills the run if exceeded.

## Investigation — Can existing pydantic-ai features replace this?

### `ModelSettings(timeout=...)` alone

Passed as `timeout=model_settings.get('timeout', NOT_GIVEN)` directly to `self.client.beta.messages.create(...)` in `AnthropicModel`. It is a **per-HTTP-request httpx timeout** — not a per-run timeout.

- When it fires: `APITimeoutError` (subclass of `APIConnectionError`) → caught by `_map_api_errors` → `ModelAPIError` → propagates uncaught through pydantic-ai graph → ardoq_ai catches in final `except Exception` → `error_type = "agent_error"` (not `"run_timeout"`).
- Does NOT cover tool execution at all — only active during the HTTP call to the model.
- Re-arms per LLM call: a run with 10 calls × 600s = could run 6000s without firing.
- No concept of nested sub-agent coordination.

### Tool `timeout` (pydantic-ai `FunctionToolset`)

From `toolsets/function.py`:
```python
with anyio.fail_after(timeout):
    return await tool.call_func(tool_args, ctx)
except TimeoutError:
    raise ModelRetry(f'Timed out after {timeout} seconds.')
```

- On expiry: raises **`ModelRetry`** — the run **continues**. Model gets a retry prompt.
- `ardoq_tool` already supports a `timeout` parameter (passed to `Tool(timeout=timeout)`) — just not used consistently.
- Per-call, not per-run. No wall-clock ceiling on the total run.

### `ModelSettings(timeout=...)` + tool `timeout` combined

Still does not replace the PR because:
1. **Termination semantics differ** — both fire as soft recoverable failures (run continues). PR's `asyncio.timeout` terminates the run.
2. **No total run ceiling** — a run stuck in a fast-LLM / fast-tool loop with many iterations is never caught.
3. **Nesting** — each agent gets independent budgets; they stack independently.

The two mechanisms are **complementary**, not alternatives:
- `ModelSettings(timeout=...)` → guard against slow individual LLM requests
- Tool `timeout` → graceful per-call recovery from slow tools
- PR's `asyncio.timeout` → hard backstop on total wall-clock duration

## Investigation — Is the PR's implementation the cleanest approach?

### What the PR gets right

- **`run_timeout` context manager** — clean, maps `TimeoutError` → `AgentRunTimeoutException`, passes `None` as a no-op.
- **Streaming consumer loop placement** — correct and necessary. `run_completion_streaming_events` runs `run_and_publish_events()` as a separate `asyncio.Task`, so `asyncio.timeout` from the outer caller doesn't cross the task boundary. The timeout must be inside the task. And within that task it must wrap the consumer loop (not the generator body) because `await publish_stream_event(...)` is awaited in the consumer between yields — a deadline firing there would escape as an unmapped `CancelledError` if the scope were inside the generator.
- **Nesting detection is necessary** (not just an optimization). The streaming path creates a new Task per agent run. asyncio copies ContextVars into new tasks at creation time, so the child task inherits the parent's context and `resolve_run_timeout()` correctly returns `None` for nested runs (preventing a fresh 600s deadline in the sub-agent task).

### Structural problems

**1. Non-streaming timeout is placed at the wrong layer.**

It lives in `_run_execute_agent`, but belongs in `run_completion` — where all other run-level concerns live (error classification, logging, `CompletionFailure` building, context lifecycle). `_run_execute_agent` now owns a concern one layer above itself.

Cleaner: move `async with run_timeout(resolve_run_timeout())` inside the try block of `run_completion`, wrapping the `execute_agent` call and result processing. `_run_execute_agent` reverts to a pure thin wrapper.

**2. `execute_agent`'s exception contract is now inconsistent.**

It normalises `UsageLimitExceeded` and `ModelHTTPError` but lets `AgentRunTimeoutException` pass through silently (compensated with a docstring `Raises:` entry). If the timeout were at `run_completion` level, `execute_agent` would have nothing to say about it.

**3. Streaming re-raises; non-streaming returns. An avoidable asymmetry.**

Non-streaming catches `AgentRunTimeoutException` and returns `CompletionFailure`. Streaming catches it, logs, and **re-raises** — requiring callers to handle an exception rather than reading a failure event.

Could instead yield a `CompletionFailure` as the terminal queue event (the protocol already accepts it) and return normally, making both paths symmetric.

**4. `AGENT_RUN_TIMEOUT_SECONDS` is not configurable.**

Module-level constant, `monkeypatch`-only in tests. Should read from env var at minimum:
```python
AGENT_RUN_TIMEOUT_SECONDS = float(os.getenv("AGENT_RUN_TIMEOUT_SECONDS", "600"))
```

## Conclusion

**`ModelSettings(timeout=...)` and tool timeouts cannot replace the PR** — they solve different problems and have different termination semantics. The PR's `asyncio.timeout` is the right mechanism for a total wall-clock ceiling.

**The PR's implementation is functionally correct but structurally imperfect:**
- Streaming path: correct placement, keep as-is.
- Non-streaming path: move timeout from `_run_execute_agent` up to `run_completion`.
- Make `AGENT_RUN_TIMEOUT_SECONDS` configurable (env var or settings).
- Consider making streaming yield `CompletionFailure` instead of re-raising for symmetry.

## Related

- [[Clients/Ardoq/AgentNotes/Active/2026-06-22 AI-962 MCP + Agent Tool Consolidation - Architecture Analysis]]
- [[Clients/Ardoq/AgentNotes/Reference/Development/Model Context Protocol (MCP)]]
