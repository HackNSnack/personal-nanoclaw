---
created: 2026-03-25
tags: [ardoq, ai-agents, architecture, reference]
---

# AgentContext Lifecycle in `run_completion`

Visual reference for how `AgentContext` instances are created, read, mutated, and restored across nested `run_completion` calls.

## Key Concepts

- **`_agent_context`**: A `ContextVar` holding the currently active `AgentContext | None`
- **`AgentContext`**: Frozen Pydantic model with `agent_name`, `span_id`, `parent_span_id`, and a mutable `accumulator` dict
- **`accumulator`**: A `dict[str, list[CompletionSuccess | CompletionFailure]]` — mutated in-place by child agents to report results upward
- Each `run_completion` call creates its own `AgentContext` with a fresh empty accumulator

## Sequence: 3-Layer Nested Agent Run

Example: Agent 1 calls Agent 2 via a tool, which calls Agent 3 via a tool.

**Participants:** CV = `_agent_context` ContextVar, A1/A2/A3 = `run_completion` for each agent.

```mermaid
sequenceDiagram
    participant CV as ContextVar
    participant A1 as Agent 1
    participant A2 as Agent 2
    participant A3 as Agent 3

    Note over CV: None

    rect rgba(0,0,0,0.05)
        Note over A1: Phase 1: Agent 1 enters
        A1->>CV: get_agent_context()
        CV-->>A1: None
        Note over A1: prev = None<br/>parent_acc = None
        A1->>CV: start_new("agent_1", {})
        Note over CV: ctx_1<br/>span=S1, parent=None<br/>acc={}
        A1->>A1: agent.run() starts
    end

    rect rgba(0,0,0,0.05)
        Note over A2: Phase 2: Agent 2 enters
        A2->>CV: get_agent_context()
        CV-->>A2: ctx_1
        Note over A2: prev = ctx_1<br/>parent_acc = ctx_1.acc
        A2->>CV: start_new("agent_2", {})
        Note over CV: ctx_2<br/>span=S2, parent=S1<br/>acc={}
        A2->>A2: agent.run() starts
    end

    rect rgba(0,0,0,0.05)
        Note over A3: Phase 3: Agent 3 enters
        A3->>CV: get_agent_context()
        CV-->>A3: ctx_2
        Note over A3: prev = ctx_2<br/>parent_acc = ctx_2.acc
        A3->>CV: start_new("agent_3", {})
        Note over CV: ctx_3<br/>span=S3, parent=S2<br/>acc={}
        A3->>A3: agent.run() completes
    end

    rect rgba(0,0,0,0.05)
        Note over A3: Phase 4: Agent 3 exits
        Note over A3: result.sub_agents<br/>= ctx_3.acc = {}
        A3-->>A2: mutate ctx_2.acc<br/>+= {agent_3: [result]}
        A3->>CV: restore(token_3)
        Note over CV: ctx_2
    end

    rect rgba(0,0,0,0.05)
        Note over A2: Phase 5: Agent 2 exits
        Note over A2: result.sub_agents<br/>= ctx_2.acc<br/>= {agent_3: [...]}
        A2-->>A1: mutate ctx_1.acc<br/>+= {agent_2: [result]}
        A2->>CV: restore(token_2)
        Note over CV: ctx_1
    end

    rect rgba(0,0,0,0.05)
        Note over A1: Phase 6: Agent 1 exits
        Note over A1: result.sub_agents<br/>= ctx_1.acc<br/>= {agent_2: [...]}
        Note over A1: parent_acc = None<br/>no upward report
        A1->>CV: restore(token_1)
        Note over CV: None
    end
```

## State Table

Shows the `_agent_context` ContextVar value and each accumulator's contents at each phase boundary.

| Phase | `_agent_context` | `ctx_1.acc` | `ctx_2.acc` | `ctx_3.acc` |
|-------|-----------------|-------------|-------------|-------------|
| Before Agent 1 enters | `None` | — | — | — |
| Agent 1 enters | `ctx_1` | `{}` | — | — |
| Agent 2 enters | `ctx_2` | `{}` | `{}` | — |
| Agent 3 enters | `ctx_3` | `{}` | `{}` | `{}` |
| Agent 3 exits | `ctx_2` | `{}` | `{"agent_3": [...]}` | `{}` |
| Agent 2 exits | `ctx_1` | `{"agent_2": [...]}` | `{"agent_3": [...]}` | `{}` |
| Agent 1 exits | `None` | `{"agent_2": [...]}` | `{"agent_3": [...]}` | `{}` |

## Key Observations

1. **Each layer only sees direct children** — Agent 1's accumulator has `agent_2` but not `agent_3`. The nested structure is preserved inside Agent 2's result via `sub_agents`.

2. **Accumulator mutation crosses context boundaries** — when Agent 3 exits, it mutates `ctx_2.accumulator` even though `ctx_2` is frozen. This works because frozen only prevents field reassignment, not dict mutation.

3. **`parent_accumulator` is captured before context switch** — line 61-62 reads the *previous* context's accumulator, then line 63 creates a new context. This is what links child results to the correct parent.

4. **Restore is in `finally`** — context is always restored even on exception, preventing context leaks.

---

*Source: `ardoq_ai/completion/non_streaming.py`, `ardoq_ai/completion/span_context.py`*
