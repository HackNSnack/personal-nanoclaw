# 03 — Agent Core (`pi-agent-core`)

## Summary

The `pi-agent-core` package (~1,900 LOC) is the low-level, framework-agnostic agent loop. It owns the turn cycle: send messages to LLM → receive assistant response → execute tool calls → repeat until done. The `Agent` class wraps this loop with state management, event subscription, and message queuing (steering + follow-up). The loop itself is purely functional — it takes callbacks for everything external (streaming, context conversion, tool hooks).

## Key Types & Interfaces

### Agent Loop Config (`agent/src/types.ts`)

| Type | Description |
|---|---|
| `AgentLoopConfig` | Central config extending `SimpleStreamOptions`: `model`, `convertToLlm`, `transformContext?`, `getApiKey?`, `getSteeringMessages?`, `getFollowUpMessages?`, `toolExecution?`, `beforeToolCall?`, `afterToolCall?` |
| `StreamFn` | `(...args: Parameters<typeof streamSimple>) → ReturnType<typeof streamSimple>` — pluggable stream function |
| `ToolExecutionMode` | `"sequential" \| "parallel"` — how multi-tool-call responses are executed |

### Agent State

| Type | Description |
|---|---|
| `AgentState` | Public state: `systemPrompt`, `model`, `thinkingLevel`, `tools` (get/set), `messages` (get/set), `isStreaming`, `streamingMessage?`, `pendingToolCalls`, `errorMessage?` |
| `AgentContext` | Snapshot: `{systemPrompt, messages: AgentMessage[], tools?: AgentTool[]}` |
| `AgentMessage` | Union: `Message \| CustomAgentMessages[keyof CustomAgentMessages]` — extensible via declaration merging |
| `CustomAgentMessages` | Empty interface for apps to extend (e.g., `notification`, `artifact` message types) |

### Tool Types

| Type | Description |
|---|---|
| `AgentTool<TParams, TDetails>` | Extends `Tool` with: `label`, `prepareArguments?`, `execute(toolCallId, params, signal?, onUpdate?)`, `executionMode?` |
| `AgentToolResult<T>` | `{content: (TextContent \| ImageContent)[], details: T}` |
| `AgentToolUpdateCallback<T>` | `(partialResult: AgentToolResult<T>) → void` |
| `AgentToolCall` | Extracted tool call content block from an assistant message |

### Hook Types

| Type | Description |
|---|---|
| `BeforeToolCallContext` | `{assistantMessage, toolCall, args, context}` |
| `BeforeToolCallResult` | `{block?: boolean, reason?: string}` — return `{block: true}` to prevent execution |
| `AfterToolCallContext` | `{assistantMessage, toolCall, args, result, isError, context}` |
| `AfterToolCallResult` | `{content?, details?, isError?}` — partial override of tool result |

### Events (`AgentEvent`)

| Event | When |
|---|---|
| `agent_start` | Agent loop begins |
| `agent_end` | Agent loop ends (last event) |
| `turn_start` / `turn_end` | One LLM response + its tool results |
| `message_start` / `message_update` / `message_end` | Message lifecycle (user, assistant, toolResult) |
| `tool_execution_start` / `tool_execution_update` / `tool_execution_end` | Tool execution lifecycle |

## Flow

### Agent.prompt() → runAgentLoop()

```
Agent.prompt(input)
  → normalizePromptInput() → AgentMessage[]
  → runWithLifecycle(signal =>
      runAgentLoop(prompts, context, loopConfig, processEvents, signal, streamFn)
    )
```

### The Agent Loop (`agent-loop.ts`)

```
runLoop(context, newMessages, config, signal, emit):

  pendingMessages = getSteeringMessages()  // check for pre-queued steering

  OUTER LOOP (follow-ups):
    INNER LOOP (turns + steering):
      1. Emit turn_start
      2. If pendingMessages: emit them, add to context
      3. streamAssistantResponse():
         a. transformContext(messages)     // AgentMessage[] → AgentMessage[] (pruning, injection)
         b. convertToLlm(messages)         // AgentMessage[] → Message[] (filter custom types)
         c. Build Context {systemPrompt, messages, tools}
         d. Resolve API key (may have expired)
         e. Call streamFn(model, context, options)
         f. Process streaming events: start → deltas → done/error
         g. Return AssistantMessage
      4. If error/aborted: emit turn_end, agent_end, return
      5. Extract tool calls from response
      6. If tool calls: executeToolCalls() → ToolResultMessage[]
      7. Emit turn_end
      8. pendingMessages = getSteeringMessages()
    END INNER

    followUps = getFollowUpMessages()
    If followUps: set as pendingMessages, continue outer loop
    Else: break
  END OUTER

  Emit agent_end
```

### Tool Execution

```
executeToolCalls(context, assistantMsg, config, signal, emit):
  Determine mode: sequential if any tool has executionMode: "sequential", else parallel

  For each tool call:
    1. Emit tool_execution_start
    2. prepareToolCall():
       a. Find tool by name
       b. prepareArguments() shim if defined
       c. validateToolArguments() against schema
       d. Call beforeToolCall hook → may block
    3. executePreparedToolCall():
       a. tool.execute(id, args, signal, onUpdate)
       b. Emit tool_execution_update for each onUpdate call
    4. finalizeExecutedToolCall():
       a. Call afterToolCall hook → may override content/details/isError
    5. Emit tool_execution_end
    6. Create ToolResultMessage

  PARALLEL MODE:
    - Steps 1-2 (prepare) run sequentially
    - Step 3 (execute) runs concurrently via Promise.all
    - Steps 4-6 complete as each resolves
    - ToolResultMessages emitted in original order
```

### Message Queuing

```
Agent:
  steeringQueue: PendingMessageQueue (mode: "all" | "one-at-a-time")
  followUpQueue: PendingMessageQueue

  steer(msg)    → enqueue to steering
  followUp(msg) → enqueue to followUp

  drain() behavior:
    "all"           → return all queued, clear
    "one-at-a-time" → return first, shift
```

Steering messages are checked after each turn's tool results. Follow-up messages are checked when the agent would otherwise stop (no more tool calls and no steering).

## Integration Points

| Connects to | How |
|---|---|
| **AI Provider (doc 02)** | `StreamFn` delegates to `streamSimple` or custom provider |
| **Agent Session (doc 04)** | `AgentSession` creates and owns the `Agent` instance, wires `convertToLlm`, `transformContext`, `beforeToolCall`, `afterToolCall` |
| **Extension System (doc 06)** | `beforeToolCall` fires extension `tool_call` event; `afterToolCall` fires `tool_result` event |
| **Tool System (doc 05)** | `AgentTool` instances from tool definitions are set on `Agent.state.tools` |

## Extension Relevance

- **`tool_call` event** maps to `beforeToolCall` hook. Return `{block: true, reason}` to prevent execution.
- **`tool_result` event** maps to `afterToolCall` hook. Return `{content?, details?, isError?}` to modify results.
- **`context` event** maps to `transformContext` callback. Return modified messages to inject/filter context.
- **Parallel tool execution** is the default. Mark tools as `executionMode: "sequential"` if they have side effects requiring ordering.
- **Custom messages**: Extend `CustomAgentMessages` via declaration merging. `convertToLlm` must handle them.

## Open Questions

1. **Error recovery in agent loop**: When `streamAssistantResponse` hits error/aborted, the loop exits immediately. No retry logic exists at this level — it's all in `AgentSession` (doc 04).
2. **Parallel tool execution ordering**: Tool results are emitted in original order, but `tool_execution_end` events fire in completion order. This means UI may see completions out of order.
3. **`agent_end` settlement**: Listeners awaited on `agent_end` are part of run settlement — `Agent.waitForIdle()` includes them. This is intentional but can cause hangs if a listener never resolves.

## Key Files Read

| File | Lines | Purpose |
|---|---|---|
| `agent/src/types.ts` | 352 | All agent types: config, state, events, tools, hooks |
| `agent/src/agent.ts` | 543 | `Agent` class: state management, queuing, lifecycle |
| `agent/src/agent-loop.ts` | 663 | `runAgentLoop`, `runLoop`, tool execution, streaming |
| `agent/src/index.ts` | ~20 | Re-exports |
| `agent/src/proxy.ts` | ~50 | Agent proxy utilities |
