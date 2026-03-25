---
tags: [architecture, pydantic-ai, agents, context-vars]
type: work
status: done
---

# Nested Sub-Agent Result Propagation Design

## Problem

pydantic-ai has no built-in sub-agent execution tracing. When agents call agents call agents, each `agent.run()` is isolated — no unified execution tree.

## Solution

Two `ContextVar`s in `completion/span_context.py` act as an implicit call-stack:

1. **`_current_span`** — tracks execution position (span_id + parent_span_id)
2. **`_sub_agent_accumulator`** — tree-building dict. Each layer creates a fresh dict, captures the parent's dict reference before overwriting.

Key mechanism in `run_completion`:
- Capture parent accumulator → install own fresh dict → run agent → write `SubAgentResult` into parent's dict → restore ContextVars via Token

ContextVars are necessary because pydantic-ai tool functions can't accept custom parameters — only `RunContext`.

## Test Agents

3-layer hierarchy demonstrating the pattern:
- `test_parent_agent` → 3 tools → each calls `run_completion(child)`
- `test_child_agent` → 3 tools → each calls `run_completion(grandchild)`
- `test_grandchild_agent` → 3 leaf tools (no sub-agents)

Total: 27 leaf tool calls, full tree captured in `CompletionSuccess.sub_agents`.

## Key Files

- `completion/non_streaming.py` — `run_completion` with accumulator logic
- `completion/span_context.py` — ContextVar definitions and helpers
- `completion/schemas/result.py` — `SubAgentResult`, `CompletionSuccess`, `CompletionFailure`

## Full Documentation

Detailed walkthrough with ASCII diagrams: `docs/nested-sub-agent-results.md`

## Related

- [[2026-03-23 SubAgentResult and completion schema complexity analysis]]
- [[2026-03-23 Simplify dynamic agent return]]
