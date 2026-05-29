# 06 — Extension System

## Summary

The extension system (~3,000 LOC across 4 files) is Pi's primary customization mechanism. Extensions are TypeScript modules loaded via `jiti` (supports both Bun binary and Node.js). They can subscribe to 30+ lifecycle events, register tools/commands/shortcuts/flags, interact with the user via UI primitives, and communicate with each other via a shared event bus. The system has three phases: **load** (registration), **bind** (runtime wiring), and **run** (event handling).

## Key Types & Interfaces

### Extension API (`types.ts`)

| Type | Description |
|---|---|
| `ExtensionAPI` | The `pi` object passed to factory functions. Methods: `on()`, `registerTool()`, `registerCommand()`, `registerShortcut()`, `registerFlag()`, `registerMessageRenderer()`, `registerProvider()`, `unregisterProvider()`, `sendMessage()`, `sendUserMessage()`, `appendEntry()`, `setSessionName()`, `exec()`, `getActiveTools()`, `setActiveTools()`, `setModel()`, `getThinkingLevel()`, `setThinkingLevel()`, `events` |
| `ExtensionFactory` | `(pi: ExtensionAPI) => void \| Promise<void>` |
| `ExtensionContext` | Context for event handlers: `ui`, `hasUI`, `cwd`, `sessionManager`, `modelRegistry`, `model`, `isIdle()`, `signal`, `abort()`, `hasPendingMessages()`, `shutdown()`, `getContextUsage()`, `compact()`, `getSystemPrompt()` |
| `ExtensionCommandContext` | Extends `ExtensionContext` with: `waitForIdle()`, `newSession()`, `fork()`, `navigateTree()`, `switchSession()`, `reload()` |
| `ExtensionHandler<E, R>` | `(event: E, ctx: ExtensionContext) => Promise<R \| void> \| R \| void` |

### UI Context (`types.ts`)

| Method | Description |
|---|---|
| `select(title, options, opts?)` | Show picker, return selected string |
| `confirm(title, message, opts?)` | Yes/no dialog |
| `input(title, placeholder?, opts?)` | Text input |
| `editor(title, prefill?)` | Multi-line editor |
| `notify(message, type?)` | Non-blocking notification |
| `setStatus(key, text)` | Footer status text |
| `setWidget(key, content, opts?)` | Widget above/below editor |
| `setFooter(factory)` | Custom footer component |
| `setHeader(factory)` | Custom header component |
| `custom(factory, opts?)` | Full custom component/overlay |
| `setEditorComponent(factory)` | Replace default editor |
| `setWorkingMessage(msg?)` | Override "Working..." text |
| `setWorkingIndicator(opts?)` | Custom spinner/indicator |
| `pasteToEditor(text)` | Programmatic paste |
| `theme` | Current `Theme` object |

All dialogs support `{signal?: AbortSignal, timeout?: number}`.

### Events (30+ types)

| Category | Events |
|---|---|
| **Resource** | `resources_discover` |
| **Session** | `session_start`, `session_shutdown`, `session_before_switch`, `session_before_fork`, `session_before_compact`, `session_compact`, `session_before_tree`, `session_tree` |
| **Agent** | `before_agent_start`, `agent_start`, `agent_end` |
| **Turn** | `turn_start`, `turn_end` |
| **Message** | `message_start`, `message_update`, `message_end` |
| **Tool Execution** | `tool_execution_start`, `tool_execution_update`, `tool_execution_end` |
| **Tool Hooks** | `tool_call` (before, can block), `tool_result` (after, can modify) |
| **Model** | `model_select` |
| **User** | `user_bash`, `input` |
| **Provider** | `before_provider_request`, `after_provider_response` |
| **Context** | `context` (transform messages before LLM) |

### Registration Types

| Type | Description |
|---|---|
| `ToolDefinition` | Full tool definition (see doc 05) |
| `RegisteredCommand` | `{name, description?, getArgumentCompletions?, handler}` |
| `ExtensionShortcut` | `{shortcut: KeyId, description?, handler}` |
| `ExtensionFlag` | `{name, description?, type: "boolean"\|"string", default?}` |
| `MessageRenderer<T>` | `(message, options, theme) → Component \| undefined` |
| `ProviderConfig` | `{baseUrl?, apiKey?, api?, models?, oauth?, streamSimple?, headers?}` |

## Architecture

### Three Phases

```
PHASE 1: LOAD (loader.ts)
  discoverAndLoadExtensions(configuredPaths, cwd, agentDir)
    1. Discover: .pi/extensions/ (project) → ~/.pi/agent/extensions/ (global) → CLI paths
    2. For each path:
       a. Resolve: file → direct; directory → package.json pi.extensions or index.ts
       b. Load via jiti (Bun: virtualModules; Node: aliases)
       c. Create Extension object with empty collections
       d. Create ExtensionAPI bound to the Extension
       e. Call factory(api) → extension registers handlers/tools/commands
    3. Return: {extensions[], errors[], runtime}

  Runtime has THROWING STUBS for action methods (sendMessage, etc.)
  Provider registrations are QUEUED in pendingProviderRegistrations

PHASE 2: BIND (runner.ts)
  runner.bindCore(actions, contextActions, providerActions)
    1. Replace throwing stubs with real implementations
    2. Flush queued provider registrations to ModelRegistry
    3. Replace registerProvider/unregisterProvider with direct calls

  runner.bindCommandContext(actions)  // for interactive mode
  runner.setUIContext(uiContext)      // for interactive mode

PHASE 3: RUN (runner.ts)
  runner.emit(event)         → generic event dispatch
  runner.emitToolCall(event) → tool_call with block semantics
  runner.emitToolResult(event) → tool_result with modification semantics
  runner.emitContext(messages) → context event chain
  runner.emitBeforeAgentStart(...) → before_agent_start with message injection
  runner.emitInput(text, images, source) → input event chain
  runner.emitResourcesDiscover(cwd, reason) → resource discovery
```

### Module Loading

`jiti` is used for TypeScript loading without a build step:

- **Bun binary mode** (`isBunBinary`): Uses `virtualModules` — pi packages are pre-bundled and injected as virtual modules. `tryNative: false` ensures jiti handles all imports.
- **Node.js/dev mode**: Uses `alias` mapping to resolve workspace packages from `node_modules` or workspace paths.

Virtual modules available to extensions:
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-tui`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-ai/oauth`
- `@sinclair/typebox`

### Extension Discovery

```
Order (first wins on path dedup):
1. .pi/extensions/ (project-local)
2. ~/.pi/agent/extensions/ (global)
3. CLI --extension paths

Per directory:
  - Direct files: *.ts, *.js
  - Subdirectory with index: subdir/index.ts or index.js
  - Subdirectory with package.json: subdir/package.json → pi.extensions paths
  - No recursion beyond one level
```

### Event Dispatch

Handlers run **in extension registration order**, **sequentially** within each extension. Key behaviors:

| Event Category | Dispatch Semantics |
|---|---|
| `tool_call` | First `{block: true}` stops execution |
| `tool_result` | Each handler sees previous handler's modifications (chain) |
| `context` | Each handler sees previous handler's message list (chain) |
| `before_provider_request` | Each handler sees previous handler's payload (chain) |
| `input` | `"handled"` short-circuits; `"transform"` chains |
| `session_before_*` | First `{cancel: true}` cancels the operation |
| All others | Fire-and-forget (errors logged, not propagated) |

### Error Handling

- Extension **load errors**: logged, extension skipped, agent continues
- Event handler **errors**: logged via `emitError()`, agent continues
- `tool_call` handler **errors**: block the tool (fail-safe — errors treated as blocks)
- Tool `execute` **errors**: caught, returned to LLM as error result with `isError: true`

### Inter-Extension Communication

`pi.events` is a shared `EventBus` (simple pub/sub):

```typescript
// Extension A
pi.events.emit("my-extension:data-ready", payload);

// Extension B
pi.events.on("my-extension:data-ready", (payload) => { ... });
```

## Integration Points

| Connects to | How |
|---|---|
| **Agent Session (doc 04)** | Session wires agent hooks to extension events; creates `ExtensionRunner` |
| **Agent Core (doc 03)** | `beforeToolCall` / `afterToolCall` delegate to extension `tool_call` / `tool_result` |
| **Tool System (doc 05)** | Extension tools via `registerTool()` become `AgentTool` instances |
| **Bootstrap (doc 01)** | Extensions loaded during `createAgentSessionServices()` |
| **Modes (doc 10)** | Interactive mode calls `runner.setUIContext()` with real UI; others get `noOpUIContext` |
| **Model Registry (doc 12)** | `registerProvider()` adds models; queued during load, flushed on bind |

## Extension Relevance

**This IS the extension system.** Key patterns:

1. **Minimal extension**: `export default (pi) => { pi.on("session_start", (e, ctx) => { ... }); }`
2. **Tool with state**: Store state in `details`, reconstruct from session entries on `session_start`.
3. **Custom UI**: `ctx.ui.custom((tui, theme, keybindings, done) => component, {overlay: true})`
4. **Override built-in**: `pi.registerTool({name: "read", ...})` replaces built-in read.
5. **CLI flag**: `pi.registerFlag("my-flag", {type: "boolean", default: false})` → `pi.getFlag("my-flag")`
6. **Non-interactive safety**: Always check `ctx.hasUI` before calling `ctx.ui.select()` etc.
7. **Provider registration**: Queued during load, applied on bind. Post-bind: immediate effect, no `/reload` needed.

## Open Questions

1. **Extension hot-reload**: `/reload` tears down and rebuilds the entire extension runtime. Stateful extensions lose in-memory state unless persisted to session.
2. **Extension ordering**: Project-local extensions load before global ones. Within a directory, order is filesystem `readdir` order (non-deterministic on some filesystems).
3. **Extension isolation**: Extensions share a single Node.js process. A blocking extension blocks all events.
4. **`tool_call` error semantics**: If a `tool_call` handler throws, the tool is blocked. This is documented as intentional (fail-safe) but may surprise extension authors expecting errors to be swallowed.

## Key Files Read

| File | Lines | Purpose |
|---|---|---|
| `coding-agent/src/core/extensions/types.ts` | 1,501 | All extension types, events, API, registration |
| `coding-agent/src/core/extensions/runner.ts` | 928 | Event dispatch, context creation, lifecycle |
| `coding-agent/src/core/extensions/loader.ts` | 557 | Discovery, jiti loading, API creation |
| `coding-agent/src/core/extensions/wrapper.ts` | 30 | Tool wrapping helper |
| `coding-agent/src/core/extensions/index.ts` | ~50 | Re-exports |
