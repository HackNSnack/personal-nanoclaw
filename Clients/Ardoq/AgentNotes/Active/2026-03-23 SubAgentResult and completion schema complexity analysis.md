---
tags: [architecture, refactoring, sub-agents, completion]
type: work
status: in-progress
---

# SubAgentResult and Completion Schema Complexity Analysis

## Problem

The current sub-agent result and completion schemas in `ardoq_ai` have accumulated unnecessary complexity:

1. **SubAgentResult Generic[OutputT] is dead** — type is erased once stored in any collection, making the generic parameter useless. Should be non-generic with `output: BaseModel | str | None`.

2. **ContextVar collector is over-engineered** — indirect pub-sub mechanism with a single subscriber. Exists only to side-channel `SubAgentResult` back to `run_completion` since tool functions can't return it directly.

3. **Schema duplication** — `CompletionSuccess` / `CompletionResponseSuccess` results in 4 classes for what is essentially a field rename.

4. **sub_agents grouping adds complexity** — `dict[str, list[...]]` grouping by agent name adds indirection vs a flat `list[SubAgentResult]`.

## Solution

Proposed simplifications:

- Remove `Generic` from `SubAgentResult`, use `output: BaseModel | str | None`
- Simplify `sub_agents` from `dict[str, list[SubAgentResult]]` to `list[SubAgentResult]`
- Consider removing the collector mechanism entirely
- Consolidate the 4 response schema classes into fewer



### The Collector Problem — Deep Dive

The collector is a ContextVar-based callback mechanism (`span_context.py:57-87`) that lets `run_sub_agent` report its `SubAgentResult` to the caller through a side-channel.

**Why it exists:** pydantic-ai tool functions must return the tool's declared type (e.g. `ChildCallResult`). But the system also needs the full `SubAgentResult` (events, spans, nested sub-agents) for observability. The tool function can't return both, so the result is pushed via a closure registered in a ContextVar.

**Flow:**
1. `run_completion` registers a `collect_sub_agent` closure into ContextVar
2. pydantic-ai calls a tool → tool calls `run_sub_agent`
3. `run_sub_agent` saves parent collector, sets its own for nested calls
4. On completion, pushes result to parent collector (side-effect) AND returns it
5. `run_completion` reads the mutated dict to include in `CompletionSuccess`

**Problems:** implicit data flow, manual stack management, dual return path, fragile nesting.

### Candidate Solutions

**Option A — Post-process from pydantic-ai messages:** Walk message history after `agent.run()` to reconstruct sub-agent results. Eliminates side-channel. Downside: tool returns would need to encode `SubAgentResult` or use a registry keyed by `tool_call_id`.

**Option B — RunContext deps accumulator:** Add `sub_agent_results: list[SubAgentResult]` to `BaseContext` (deps). Tools append directly — no ContextVar needed. Explicit, type-safe, scoped to agent run. Generic and reusable pattern.

**Option C — ContextVar stack:** Replace save/set/reset with a single `ContextVar[list[list[SubAgentResult]]]` stack. Less ceremony, same mechanism. Smallest change but doesn't fix implicit data flow.

### Decision

Leaning towards **Option B** — deps-based accumulator. Generic, reusable, explicit.
## Related

- [[Clients/Ardoq/AgentNotes/Active/2026-03-23 Simplify dynamic agent return]]
