---
tags: [architecture, pydantic-ai, agents, context-vars, reference]
type: reference
---

# Nested Sub-Agent Result Propagation

How `run_completion` + `span_context` collaborate to capture a full execution tree from arbitrarily nested pydantic-ai agents.

## The Problem

pydantic-ai has no built-in concept of sub-agent execution tracing. When Agent A's tool calls Agent B, which calls Agent C, pydantic-ai sees each `agent.run()` in isolation. There's no way to get a unified tree of "what happened" across the full hierarchy.

This system solves that using two Python `ContextVar`s that act as an implicit call-stack, threading accumulator dicts through nested `run_completion` calls without passing them as explicit arguments.

## The Two ContextVars

Both live in `span_context.py`:

### 1. `_current_span: ContextVar[SpanContext | None]`

Tracks **where we are** in the hierarchy. Each `SpanContext` is a frozen Pydantic model:

```
SpanContext(span_id="uuid-xxx", parent_span_id="uuid-yyy" | None, agent_name="...")
```

- Top-level call: `parent_span_id = None`
- Nested call: `parent_span_id = parent's span_id`

Used to stamp every `RunEvent` (tool calls, tool results, errors) with its origin span.

### 2. `_sub_agent_accumulator: ContextVar[dict[str, list[SubAgentResult]] | None]`

Tracks **where to report results to**. Each layer creates a fresh `dict` and sets it as the current accumulator. When a child finishes, it writes its `SubAgentResult` into the *parent's* dict (captured before the swap).

## The Mechanism: Step by Step

Here is the core of `run_completion`, annotated:

```python
# 1. Create a new span (child of whatever is current)
span, span_token = create_child_span(agent_name)

# 2. Capture the PARENT's accumulator (will be None for top-level)
parent_accumulator = get_sub_agent_accumulator()

# 3. Install OUR OWN fresh accumulator (children will write into this)
collected_sub_agents: dict[str, list[SubAgentResult]] = {}
accumulator_token = set_sub_agent_accumulator(collected_sub_agents)

try:
    # 4. Run the agent (tools may recursively call run_completion)
    agent_result = await agent.run(...)

    # 5. Build our result, INCLUDING whatever children deposited
    result = CompletionSuccess(
        events=events,
        output=agent_result.output,
        sub_agents=collected_sub_agents,  # <-- children wrote here
    )

    # 6. If we HAVE a parent, report ourselves into their accumulator
    if parent_accumulator is not None:
        parent_accumulator.setdefault(agent_name, []).append(
            SubAgentResult(..., sub_agents=collected_sub_agents)
        )

    return result

finally:
    # 7. Restore both ContextVars to their previous state
    reset_sub_agent_accumulator(accumulator_token)
    restore_span(span_token)
```

The key insight: **step 2 captures the parent's dict, step 3 replaces it with ours, step 6 writes into the parent's dict**. This is what builds the tree.

## Full 3-Layer Walkthrough

Using the test agents: `test_parent_agent` -> `test_child_agent` -> `test_grandchild_agent`.

### Invocation Tree

```
run_completion(parent)                           # Entry point (e.g. from HTTP handler)
  |
  +-- parent LLM calls tools: alpha, beta, gamma
  |     |
  |     +-- call_child_alpha -> run_completion(child)
  |     |     |
  |     |     +-- child LLM calls tools: gc_alpha, gc_beta, gc_gamma
  |     |     |     |
  |     |     |     +-- call_grandchild_alpha -> run_completion(grandchild)
  |     |     |     |     +-- grandchild calls: get_greeting_alpha/beta/gamma (leaf tools, no sub-agents)
  |     |     |     |
  |     |     |     +-- call_grandchild_beta -> run_completion(grandchild)
  |     |     |     |     +-- grandchild calls: get_greeting_alpha/beta/gamma
  |     |     |     |
  |     |     |     +-- call_grandchild_gamma -> run_completion(grandchild)
  |     |     |           +-- grandchild calls: get_greeting_alpha/beta/gamma
  |     |     |
  |     |     +-- child returns (with 3 grandchild SubAgentResults)
  |     |
  |     +-- call_child_beta -> run_completion(child)
  |     |     +-- (same 3 grandchild calls)
  |     |
  |     +-- call_child_gamma -> run_completion(child)
  |           +-- (same 3 grandchild calls)
  |
  +-- parent returns (with 3 child SubAgentResults, each containing 3 grandchild SubAgentResults)
```

Total: 3 children x 3 grandchildren x 3 leaf tools = **27 leaf tool calls**.

### ContextVar State at Each Layer

Below shows the state of both ContextVars at the moment `agent.run()` executes for each layer.

#### Layer 1: Parent `run_completion` starts

```
_current_span:          SpanContext(span_id="P1", parent_span_id=None, agent_name="test_parent_agent")
_sub_agent_accumulator: {} (parent's fresh dict -- "collected_sub_agents_P")
parent_accumulator:     None (no parent above us)
```

#### Layer 2: Child `run_completion` starts (inside `call_child_alpha` tool)

```
_current_span:          SpanContext(span_id="C1", parent_span_id="P1", agent_name="test_child_agent")
_sub_agent_accumulator: {} (child's fresh dict -- "collected_sub_agents_C1")
parent_accumulator:     ref to collected_sub_agents_P (the parent's dict)
```

#### Layer 3: Grandchild `run_completion` starts (inside `call_grandchild_alpha` tool)

```
_current_span:          SpanContext(span_id="G1", parent_span_id="C1", agent_name="test_grandchild_agent")
_sub_agent_accumulator: {} (grandchild's fresh dict -- "collected_sub_agents_G1")
parent_accumulator:     ref to collected_sub_agents_C1 (the child's dict)
```

The grandchild has no sub-agents, so `collected_sub_agents_G1` stays `{}`.

### Unwinding: How Results Propagate Back Up

#### Grandchild G1 finishes

```python
# G1's parent_accumulator points to collected_sub_agents_C1
parent_accumulator.setdefault("test_grandchild_agent", []).append(
    SubAgentResult(agent_name="test_grandchild_agent", span_id="G1", events=[...], output=TestGrandchildOutput(...), sub_agents={})
)
# collected_sub_agents_C1 is now:
# {"test_grandchild_agent": [SubAgentResult(G1)]}
```

Then G1 restores both ContextVars, so we're back to child C1's context.

#### Grandchild G2, G3 finish (same child C1)

```
# collected_sub_agents_C1 is now:
# {"test_grandchild_agent": [SubAgentResult(G1), SubAgentResult(G2), SubAgentResult(G3)]}
```

#### Child C1 finishes

```python
# C1's parent_accumulator points to collected_sub_agents_P
parent_accumulator.setdefault("test_child_agent", []).append(
    SubAgentResult(
        agent_name="test_child_agent",
        span_id="C1",
        events=[...],              # C1's own tool_call/tool_result events
        output=TestChildOutput(...),
        sub_agents={               # C1's children (the 3 grandchildren)
            "test_grandchild_agent": [SubAgentResult(G1), SubAgentResult(G2), SubAgentResult(G3)]
        }
    )
)
```

Then C1 restores ContextVars back to parent context.

#### After all 3 children (C1, C2, C3) finish

```
# collected_sub_agents_P is now:
# {
#   "test_child_agent": [
#     SubAgentResult(C1, sub_agents={"test_grandchild_agent": [G1, G2, G3]}),
#     SubAgentResult(C2, sub_agents={"test_grandchild_agent": [G4, G5, G6]}),
#     SubAgentResult(C3, sub_agents={"test_grandchild_agent": [G7, G8, G9]}),
#   ]
# }
```

#### Parent returns

```python
CompletionSuccess(
    events=[...],                  # Parent's own events (3 tool calls + 3 tool results)
    output=TestParentOutput(...),
    sub_agents={                   # Full tree
        "test_child_agent": [
            SubAgentResult(C1, sub_agents={"test_grandchild_agent": [G1, G2, G3]}),
            SubAgentResult(C2, sub_agents={"test_grandchild_agent": [G4, G5, G6]}),
            SubAgentResult(C3, sub_agents={"test_grandchild_agent": [G7, G8, G9]}),
        ]
    }
)
```

Since `parent_accumulator` was `None` for the top-level call, nothing is written upward -- the buck stops here.

### Visual: ContextVar Stack Over Time

```
TIME ──────────────────────────────────────────────────────────────►

SPAN CONTEXTVAR (_current_span):

  ┌──────────────────── P1 (parent) ────────────────────────────────────────┐
  │              ┌──── C1 (child) ─────────────┐                            │
  │              │   ┌─ G1 ─┐ ┌─ G2 ─┐ ┌─ G3 ─┐                           │
  │              │   └──────┘ └──────┘ └──────┘│                            │
  │              └─────────────────────────────┘                            │
  │              ┌──── C2 (child) ─────────────┐                            │
  │              │   ┌─ G4 ─┐ ┌─ G5 ─┐ ┌─ G6 ─┐                           │
  │              │   └──────┘ └──────┘ └──────┘│                            │
  │              └─────────────────────────────┘                            │
  │              ┌──── C3 (child) ─────────────┐                            │
  │              │   ┌─ G7 ─┐ ┌─ G8 ─┐ ┌─ G9 ─┐                           │
  │              │   └──────┘ └──────┘ └──────┘│                            │
  │              └─────────────────────────────┘                            │
  └─────────────────────────────────────────────────────────────────────────┘

ACCUMULATOR CONTEXTVAR (_sub_agent_accumulator):

  ┌──── collected_P {} ─────────────────────────────────────────────────────┐
  │     ┌── collected_C1 {} ───────────┐                                    │
  │     │  ┌─ collected_G1 {} ─┐       │                                    │
  │     │  └───────────────────┘       │  (G1 writes into collected_C1)     │
  │     │  ┌─ collected_G2 {} ─┐       │                                    │
  │     │  └───────────────────┘       │  (G2 writes into collected_C1)     │
  │     │  ┌─ collected_G3 {} ─┐       │                                    │
  │     │  └───────────────────┘       │  (G3 writes into collected_C1)     │
  │     └──────────────────────────────┘  (C1 writes into collected_P)      │
  │     ┌── collected_C2 {} ───────────┐                                    │
  │     │  ...same pattern...          │                                    │
  │     └──────────────────────────────┘  (C2 writes into collected_P)      │
  │     ┌── collected_C3 {} ───────────┐                                    │
  │     │  ...same pattern...          │                                    │
  │     └──────────────────────────────┘  (C3 writes into collected_P)      │
  └─────────────────────────────────────────────────────────────────────────┘
```

### Visual: The Resulting Data Tree

```
CompletionSuccess (Parent)
├── events: [ToolCall(alpha), ToolCall(beta), ToolCall(gamma),
│            ToolResult(alpha), ToolResult(beta), ToolResult(gamma)]
├── output: TestParentOutput
└── sub_agents:
    └── "test_child_agent":
        ├── [0] SubAgentResult (C1 - alpha)
        │   ├── events: [ToolCall(gc_alpha), ToolCall(gc_beta), ToolCall(gc_gamma),
        │   │            ToolResult(gc_alpha), ToolResult(gc_beta), ToolResult(gc_gamma)]
        │   ├── output: TestChildOutput
        │   └── sub_agents:
        │       └── "test_grandchild_agent":
        │           ├── [0] SubAgentResult (G1 - alpha)
        │           │   ├── events: [ToolCall(greeting_a), ToolCall(greeting_b), ToolCall(greeting_g),
        │           │   │            ToolResult(greeting_a), ToolResult(greeting_b), ToolResult(greeting_g)]
        │           │   ├── output: TestGrandchildOutput
        │           │   └── sub_agents: {}
        │           ├── [1] SubAgentResult (G2 - beta)
        │           │   └── ...same structure...
        │           └── [2] SubAgentResult (G3 - gamma)
        │               └── ...same structure...
        ├── [1] SubAgentResult (C2 - beta)
        │   └── ...same structure with G4, G5, G6...
        └── [2] SubAgentResult (C3 - gamma)
            └── ...same structure with G7, G8, G9...
```

## Why ContextVars Instead of Explicit Arguments?

The accumulator can't be passed as an argument because **tools don't control their own signature** in pydantic-ai. A tool function like `call_child_alpha` receives a `RunContext` from pydantic-ai -- there's no way to inject an extra "accumulator" parameter. `ContextVar` solves this by making it implicitly available to any `run_completion` call anywhere in the call stack without modifying any function signatures.

The same applies to span tracking: tools need to know their parent span, but pydantic-ai doesn't provide a mechanism for that.

## Why Token-Based Save/Restore?

Python's `ContextVar.set()` returns a `Token` that can be used with `.reset()` to restore the *exact* previous value. This is more robust than manually saving/restoring because:

1. It's **atomic** -- there's no window where the value is inconsistent
2. It works correctly with **async concurrency** -- if multiple children run concurrently (e.g. pydantic-ai calling multiple tools in parallel), each gets its own ContextVar state via the token mechanism
3. The `finally` block guarantees cleanup even on exceptions

## Edge Case: Failure Propagation

When a child fails (exception in `agent.run()`), the same accumulator pattern applies: a `SubAgentResult` with `status="failure"` is written to the parent's accumulator. This means the parent's result tree is **always complete** -- it shows exactly which children succeeded and which failed, and any grandchild results that were captured before the failure.

## Key Files

- `completion/non_streaming.py` -- `run_completion` with accumulator logic
- `completion/span_context.py` -- ContextVar definitions and helpers
- `completion/schemas/result.py` -- `SubAgentResult`, `CompletionSuccess`, `CompletionFailure`
