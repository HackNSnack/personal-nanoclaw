---
tags: [refactor, completion, context-var, sub-agents]
type: work
status: in-progress
---

# Replace Collector Callback with Dict Accumulator

## Problem
The ContextVar-based sub-agent result collector used a `Callable[[SubAgentResult], None]` callback. Each level created a closure capturing a local dict, set it as the ContextVar, and children invoked the callback to push results. This was indirect — a closure wrapping a dict mutation when we could share the dict directly.

## Solution
Replaced `ContextVar[Callable | None]` with `ContextVar[dict[str, list[SubAgentResult]] | None]`.

- No closures created at any level
- Each level sets its own dict into the ContextVar
- Children read the parent's dict and append directly
- Same save/set/restore token pattern (required by ContextVar for nesting)

### Files changed
- `ardoq_ai/completion/span_context.py` — New `_sub_agent_accumulator` ContextVar and `get/set/reset_sub_agent_accumulator()` functions. Removed `SubAgentResultCollector` type alias and callback-based API.
- `ardoq_ai/completion/non_streaming.py` — Removed `collect_sub_agent` closure, passes dict directly to `set_sub_agent_accumulator()`.
- `ardoq_ai/completion/sub_agent.py` — Parent reporting changed from `parent_collector(sub_result)` to `parent_accumulator.setdefault(...).append(sub_result)`.
- `tests/test_sub_agent.py` — `TestResultCollector` → `TestSubAgentAccumulator`, tests dict-based API.

Branch: `AI-return-nested-outputs-from-agents`

## Related
- [[2026-03-22 Nested sub-agent result collection]]
