---
tags:
  - streaming
  - agents
  - architecture
  - pydantic-ai
type: work
status: done
---

# Streaming nested sub-agent events to the end user

## Problem

When an outer agent calls a sub-agent as a pydantic-ai tool, the sub-agent's intermediate streaming events (message deltas, tool calls, tool results) are invisible to the end user. They are consumed silently inside the tool body. The end user only sees:

1. The outer agent's `ToolCall` event (sub-agent invocation begins)
2. The outer agent's `ToolResult` event (sub-agent invocation ends, returns a string)
3. The sub-agent's final `CompletionSuccess` in the terminal `sub_agents` dict

This is true even when the sub-agent uses `run_completion_streaming_events` internally — all those intermediate events are discarded inside the tool.

**Confirmed: this understanding is correct.** Inner events are effectively synchronous from the end user's perspective, even when the inner logic is fully streaming.

## Investigation

### Why — the tool boundary

The outer generator drives pydantic-ai directly:

```python
result_events = await execute_agent(agent, ..., streaming=True)

async for event in result_events:   # ← outer generator suspended here
    if isinstance(event, FunctionToolCallEvent):
        yield tool_call_from_event(event)
    elif isinstance(event, FunctionToolResultEvent):
        yield tool_outcome_from_event(event)
    ...
```

When pydantic-ai reaches a tool call, it does (internally):

```
yield FunctionToolCallEvent      # outer generator yields this to consumer
await tool_func(ctx, **args)     # ← pydantic-ai blocks here until tool returns
yield FunctionToolResultEvent    # outer generator yields this only after tool returns
```

While pydantic-ai is awaiting `tool_func`, the `async for event in result_events` loop is suspended at `__anext__()`. **The outer generator cannot yield anything during this period.** No matter what the tool does internally — including draining a full inner streaming generator — those events have nowhere to go.

### Timeline

```
Time →

[outer stream]  ToolCall ─────────────────────────────── ToolResult  Message  Success
[inner stream]            [Msg] [Msg] [Msg] [ToolCall] [ToolResult] [Success]
                          ↑ all consumed silently inside tool_func
```

This is not a design flaw in the codebase — it is a structural constraint of pydantic-ai's tool execution model. A tool is a coroutine that must resolve to a return value. Pydantic-ai has no concept of a "streaming tool" that emits intermediate events into the outer stream.

### The chain that needs breaking

```
outer generator
  └─ async for event in pydantic_ai.run_stream_events()
                              └─ awaits tool_func()
                                   └─ async for event in inner_generator
```

All three levels are synchronously chained. Inner events can only escape if this chain is broken.

## Solutions — two tiers

Streaming inner *content* (message deltas) and streaming inner *structure* (tool call names) are different problems with different cost/complexity tradeoffs.

---

### Tier 1 — Inner tool call names, near-real-time (simple)

**Goal:** tell the user "agent 2 called tool X" shortly after it happens, without live message content.

**Key insight:** tool call names are discrete events, not a continuous feed. Delivering them slightly late — bundled just before `ToolResult` — is still useful and looks nearly real-time from the user's perspective.

**Mechanism: shared mutable list on `AgentContext`, flushed on `FunctionToolResultEvent`**

The inner generator already yields `ToolCall`/`ToolResult` domain objects — they are currently discarded in the drain loop. Instead, the inner `run_completion_streaming_events` appends them to the *parent* context's `inner_events` list (same pattern as `accumulator`). The outer generator flushes the list immediately when it processes `FunctionToolResultEvent`.

```
Time →

[outer stream]  ToolCall ────────────── [tc1 tr1 tc2 tr2 replayed here] ToolResult  Message  Success
[inner drain]             tc1 tr1 tc2 tr2 ✓        ↑ flushed from list
```

Events arrive at the consumer just before `ToolResult` — slightly late but in the right order, with no extra asyncio complexity.

#### Changes required

**1. `inner_events` list on `AgentContext`** (`span_context.py`)

```python
class AgentContext(BaseModel, frozen=True):
    agent_name: str
    span_id: str
    parent_span_id: str | None = None
    accumulator: AgentAccumulator
    inner_events: list[ToolCall | ToolResult | ToolError]  # new — mutable, shared by ref
```

**2. Inner generator appends to parent's list** (`streaming.py`)

```python
if isinstance(event, FunctionToolCallEvent):
    tc = tool_call_from_event(event).model_copy(update=span_update)
    yield tc
    if parent_accumulator is not None and previous_context is not None:
        previous_context.inner_events.append(tc)  # surface to parent
```

**3. Outer generator flushes on `FunctionToolResultEvent`** (`streaming.py`)

```python
elif isinstance(event, FunctionToolResultEvent):
    for inner_event in current_context.inner_events:
        yield inner_event
    current_context.inner_events.clear()
    yield tool_outcome_from_event(event).model_copy(update=span_update)
```

No new event types, no background tasks, no queues. ~10 lines of change.

---

### Tier 1b — Inner tool call names, truly real-time

**Goal:** same as Tier 1 but the tool call name reaches the user *as soon as it is invoked*, not after the sub-agent finishes.

**Requires:** the queue + background task approach — but in a much simpler form than Tier 2, because tool calls are infrequent discrete events. No debouncing, no partial JSON, no message delta state.

The queue only ever receives `ToolCall`/`ToolResult` items from inner agents. The background task runs the pydantic-ai stream as before. When the tool fires a `FunctionToolCallEvent` inside `run_completion_streaming_events`, it does `queue.put_nowait(InnerAgentEvent(...))` immediately — the outer consumer picks it up on its next `await queue.get()`, which happens as soon as the current outer event has been yielded.

This is the same architecture as Tier 2 below, but with a much smaller payload and no streaming-content complexity.

**Critical ContextVar ordering constraint** (applies to all queue-based solutions):

`asyncio.create_task()` snapshots the ContextVar at creation time. The `AgentContext` containing the queue **must exist before** `create_task()` is called. The queue object is shared by reference (mutable), so mutations by the tool are visible to the consumer — but only if the task was created after the context was set.

---

### Tier 2 — Full inner content streaming (complex)

**Goal:** stream inner agent message deltas to the user in real time.

**Mechanism:** `asyncio.Queue` + background task. Pydantic-ai runs in a background `asyncio.Task` that feeds `OuterEvent` items into a shared queue. The tool pushes `InnerAgentEvent` items (including message deltas) to the same queue. The outer generator becomes a pure queue consumer, interleaving both.

```
outer generator (consumer)
  └─ async for item in asyncio.Queue

                   ↑ two producers write concurrently:

Producer A (asyncio.Task)            Producer B (inside tool_func)
└─ async for event in                └─ async for event in
   pydantic_ai.run_stream_events()      inner_generator
   → queue.put(OuterEvent(event))       → queue.put(InnerAgentEvent(event, depth=1))
```

#### Additional changes required beyond Tier 1b

- `InnerAgentEvent` must wrap `Message` deltas (not just `ToolCall`/`ToolResult`)
- Debounce logic must be re-applied at the consumer level for inner message deltas
- Error handling for the background task (cancelled, timed out, etc.)
- Sentinel value to signal end-of-stream from the producer task

---

### Summary table

| Goal | Mechanism | Timing | Complexity |
|---|---|---|---|
| Inner tool call names | Mutable list on `AgentContext`, flush on `FunctionToolResultEvent` | Slightly delayed (end of sub-agent call) | Low — ~10 lines |
| Inner tool call names, live | Queue + background task, push `ToolCall` only | Truly real-time | Medium |
| Inner message content, live | Queue + background task, push all events incl. deltas | Truly real-time | High |

For the "what is the agent doing?" use case, **Tier 1 (the list approach) is the right starting point** — it requires almost no refactoring and delivers the information with acceptable latency. Tier 1b or Tier 2 are only warranted if the UX specifically requires live updates during a long-running inner agent call.

## Related

- [[Clients/Ardoq/AgentNotes/Reference/Development/Dynamic Agent Context Flow]]
- `libs/ardoq_ai/ardoq_ai/completion/streaming.py` — `run_completion_streaming_events`
- `libs/ardoq_ai/ardoq_ai/completion/span_context.py` — `AgentContext`, `start_new_agent_context`
- `libs/ardoq_ai/ardoq_ai/agents/nested_demo/agent.py` — demo agent that exercises this path
