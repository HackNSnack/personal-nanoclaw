# 04 — Agent Session & Conversation Loop

## Summary

The `AgentSession` class (~3,000 LOC) is the high-level orchestration layer that wraps the low-level `Agent` (doc 03). It owns: model/thinking management, session persistence, compaction (auto + manual), bash execution, tool registry, extension integration, prompt expansion, skill invocation, and retry logic. All three modes (interactive, print, RPC) use `AgentSession` — they differ only in their I/O layer.

## Key Types & Interfaces

| Type | Description |
|---|---|
| `AgentSession` | Core class. Holds `Agent`, `SessionManager`, `ExtensionRunner`, `ModelRegistry`, `SettingsManager`, `ResourceLoader`, tool registry |
| `AgentSessionConfig` | Constructor config: `agent`, `sessionManager`, `settingsManager`, `cwd`, `scopedModels?`, `resourceLoader`, `customTools?`, `modelRegistry`, `initialActiveToolNames?`, `allowedToolNames?`, `baseToolsOverride?`, `extensionRunnerRef?`, `sessionStartEvent?` |
| `AgentSessionEvent` | Extends `AgentEvent` with: `queue_update`, `compaction_start`, `compaction_end`, `auto_retry_start`, `auto_retry_end` |
| `PromptOptions` | `expandPromptTemplates?`, `images?`, `streamingBehavior?`, `source?`, `preflightResult?` |
| `ExtensionBindings` | `uiContext?`, `commandContextActions?`, `shutdownHandler?`, `onError?` |
| `ModelCycleResult` | `{model, thinkingLevel, isScoped}` |
| `SessionStats` | Session file info for `/session` command |
| `ParsedSkillBlock` | `{name, location, content, userMessage}` — parsed from `<skill>` XML in user messages |

## Flow

### AgentSession Construction

```
new AgentSession(config):
  1. Store references: agent, sessionManager, settingsManager, etc.
  2. Create built-in tool definitions: createAllToolDefinitions(cwd)
     → read, write, edit, bash, grep, find, ls
  3. Register extension tools: wrapRegisteredTools(extensionRunner.getAllRegisteredTools())
  4. Apply tool filtering: initialActiveToolNames or allowedToolNames
  5. Set agent.state.tools = resolved tool list
  6. Subscribe to agent events → session persistence + extension event forwarding
  7. Wire agent callbacks:
     - convertToLlm: filter messages, handle custom types
     - transformContext: call extensionRunner.emitContext()
     - beforeToolCall: call extensionRunner.emitToolCall()
     - afterToolCall: call extensionRunner.emitToolResult()
     - getSteeringMessages / getFollowUpMessages: from queues
     - onPayload: call extensionRunner.emitBeforeProviderRequest()
     - onResponse: emit after_provider_response
     - getApiKey: dynamic key resolution per-provider
```

### Prompting Flow

```
AgentSession.prompt(text, options?):
  1. Input event: extensionRunner.emitInput(text, images, source)
     → may transform text, or mark as "handled" (skip agent)
  2. Expand prompt templates: /template args → full text
  3. Parse skill blocks: <skill name="...">...</skill>
  4. Build system prompt: buildSystemPrompt(options)
  5. Before agent start: extensionRunner.emitBeforeAgentStart()
     → extensions may inject custom messages, modify system prompt
  6. If agent is streaming:
     → steer(message) or followUp(message) based on streamingBehavior
  7. If agent is idle:
     → Set system prompt on agent
     → agent.prompt(messages)
  8. On agent_end: persist to session, handle auto-retry if needed
```

### Agent Event → Session Persistence

The session subscribes to all agent events and persists them:

| Agent Event | Session Action |
|---|---|
| `message_end` (user) | Append `SessionMessageEntry` to session file |
| `message_end` (assistant) | Append entry, update token tracking |
| `message_end` (toolResult) | Append entry |
| `turn_end` | Check for auto-compaction threshold |
| `agent_end` | Final persistence checkpoint |

### Extension Event Forwarding

The agent's hook callbacks forward to extension events:

| Agent Hook | Extension Event | Extension Can... |
|---|---|---|
| `beforeToolCall` | `tool_call` | Block execution, mutate `event.input` |
| `afterToolCall` | `tool_result` | Modify content/details/isError |
| `transformContext` | `context` | Modify message list |
| `onPayload` | `before_provider_request` | Replace HTTP payload |
| `onResponse` | `after_provider_response` | Inspect headers |

Additionally, `AgentSession` emits these extension events directly:
- `before_agent_start`, `agent_start`, `agent_end`
- `turn_start`, `turn_end`
- `message_start`, `message_update`, `message_end`
- `tool_execution_start`, `tool_execution_update`, `tool_execution_end`
- `model_select`

### Auto-Compaction

```
On turn_end:
  1. estimateContextTokens(messages, model)
  2. If tokens > model.contextWindow * compactThreshold:
     → trigger compaction (see doc 08)
  3. On context overflow error from provider:
     → trigger compaction with reason "overflow"
     → retry the failed turn
```

### Auto-Retry

```
On agent_end with errorMessage:
  1. Classify error: context overflow, rate limit, transient
  2. Context overflow → compact and retry
  3. Rate limit → wait (capped by maxRetryDelayMs) and retry
  4. Transient → retry with exponential backoff
  5. Max attempts: configurable via settings
```

### Model Management

```
AgentSession:
  .model → current model (get/set)
  .setModel(model) → validate API key, emit model_select
  .cycleModel(direction) → cycle through scopedModels or all models
  .thinkingLevel → current level (get/set)
  .setThinkingLevel(level) → clamp to model capabilities
```

## Integration Points

| Connects to | How |
|---|---|
| **Agent Core (doc 03)** | Creates and owns `Agent` instance; wires all callbacks |
| **Extension System (doc 06)** | Forwards all agent events to `ExtensionRunner`; extension tools registered in tool registry |
| **Session Management (doc 07)** | Persists messages via `SessionManager.appendEntry()` |
| **Compaction (doc 08)** | Triggers compaction on threshold or overflow |
| **System Prompt (doc 09)** | Calls `buildSystemPrompt()` before each agent turn |
| **Tool System (doc 05)** | Creates tool definitions, manages active tool set |
| **Model Registry (doc 12)** | Resolves API keys, discovers models for cycling |
| **Skills (doc 11)** | Parses `<skill>` blocks from user messages |

## Extension Relevance

- **System prompt modification**: `before_agent_start` handler can return `{systemPrompt: newPrompt}` — multiple extensions chain.
- **Message injection**: `before_agent_start` can return `{message: {customType, content, display, details}}` to inject custom messages before the turn.
- **Input transformation**: `input` event can transform or consume user text before it reaches the agent.
- **Tool management**: `pi.getActiveTools()`, `pi.setActiveTools(names)` control which tools the LLM sees.
- **Compaction control**: `session_before_compact` event can cancel or provide custom compaction.
- **Model access**: `ctx.model` in event handlers gives current model; `pi.setModel()` changes it.

## Open Questions

1. **`convertToLlm` filtering**: Custom messages with `display: "tool"` are converted to tool results. Other custom types are filtered out. Is this documented for extension authors?
2. **Concurrent prompt calls**: `Agent.prompt()` throws if already streaming. The queueing mechanism (steer/followUp) handles this, but race conditions in rapid UI interaction are possible.
3. **Extension tool registration after session start**: Tools registered via `registerTool()` during `session_start` are picked up. But tools registered later (e.g., in a command handler) require `refreshTools()` — is this documented?

## Key Files Read

| File | Lines | Purpose |
|---|---|---|
| `coding-agent/src/core/agent-session.ts` | 3,082 | Core session class (first 200 lines + inferred from types) |
| `coding-agent/src/core/agent-session-services.ts` | ~300 | Service container |
| `coding-agent/src/core/agent-session-runtime.ts` | ~150 | Runtime wrapper |
| `coding-agent/src/core/messages.ts` | ~100 | Custom message types |
