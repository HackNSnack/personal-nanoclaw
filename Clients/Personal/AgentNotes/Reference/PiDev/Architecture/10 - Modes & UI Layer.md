# 10 — Modes & UI Layer

## Summary

Pi operates in four modes: **interactive** (full TUI), **print** (one-shot output), **JSON** (event stream), and **RPC** (headless JSON protocol). Interactive mode (~5,100 LOC) is by far the largest, implementing the full terminal UI with components for messages, tool execution, session tree, model selector, and more. Print and JSON modes share `runPrintMode()` (~170 LOC). RPC mode implements a JSONL-based bidirectional protocol.

## Key Types & Interfaces

| Type | Description |
|---|---|
| `InteractiveMode` | Main TUI class. Creates `TUI` (terminal renderer), `ProcessTerminal`, all UI components, wires agent events to rendering |
| `AppMode` | `"interactive" \| "print" \| "json" \| "rpc"` |
| `Mode` | CLI-level: `"text" \| "json" \| "rpc"` |

### Interactive Mode Components (~30 components)

| Component | Purpose |
|---|---|
| `AssistantMessageComponent` | Renders streamed assistant text with markdown |
| `UserMessageComponent` | Renders user messages with images |
| `ToolExecutionComponent` | Tool call + result display with expand/collapse |
| `BashExecutionComponent` | Special bash output rendering |
| `TreeSelectorComponent` | Session tree navigator |
| `ModelSelectorComponent` | Model picker (fuzzy search) |
| `SessionSelectorComponent` | Session browser |
| `ThinkingSelectorComponent` | Thinking level picker |
| `SettingsSelectorComponent` | Settings editor |
| `FooterComponent` | Status bar: cwd, model, tokens, cost, context % |
| `DynamicBorderComponent` | Colored border based on thinking level |
| `CountdownTimerComponent` | Timer for auto-dismissing dialogs |
| `ExtensionSelectorComponent` | Generic select for extension UI |
| `ExtensionInputComponent` | Text input for extension UI |
| `ExtensionEditorComponent` | Multi-line editor for extension UI |
| `CustomEditorComponent` | Base class for custom editors (vim, etc.) |
| `LoginDialogComponent` | OAuth login flow |
| `DiffComponent` | File diff rendering |
| `SkillInvocationComponent` | Skill loading display |

### TUI Integration (`pi-tui` package)

| Type | Description |
|---|---|
| `TUI` | Terminal UI manager: `addChild()`, `removeChild()`, `setFocus()`, `start()`, `stop()` |
| `ProcessTerminal` | Terminal I/O: stdin/stdout, raw mode, resize events |
| `Component` | `{render(width): string[], height: number}` |
| `Focusable` | Extends Component with `{onKey(key): boolean, onResize?()}` |
| `EditorComponent` | Text editor interface for input |
| `OverlayHandle` | Handle for overlay visibility control |
| `OverlayOptions` | `{anchor, width, margin, minWidth, maxWidth}` |

## Flow

### Interactive Mode Lifecycle

```
new InteractiveMode(runtime, options):
  1. Create TUI with ProcessTerminal
  2. Initialize theme (with file watcher for hot-reload)
  3. Create all UI components
  4. Bind extension runner to interactive UI context
  5. Wire agent events to component updates

interactiveMode.run():
  1. Start TUI
  2. Show startup header (model, extensions, skills)
  3. If initialMessage: prompt immediately
  4. Enter input loop:
     a. Wait for user input (editor component)
     b. Parse input:
        - /command → dispatch to slash command
        - !command → user bash execution
        - !!command → silent bash (excluded from LLM)
        - @file → file reference expansion
        - text → agentSession.prompt(text)
     c. Stream agent response → update components
     d. Repeat until /quit or Ctrl+C×2
```

### Extension UI Context (Interactive)

When interactive mode binds the extension runner, it provides a real `ExtensionUIContext`:

```typescript
runner.setUIContext({
  select: (title, options) => show ExtensionSelectorComponent overlay,
  confirm: (title, message) => show confirmation overlay,
  input: (title, placeholder) => show ExtensionInputComponent overlay,
  editor: (title, prefill) => show ExtensionEditorComponent overlay,
  notify: (msg, type) => render notification in message area,
  setStatus: (key, text) => update footer status section,
  setWidget: (key, content) => add component above/below editor,
  custom: (factory, opts) => render custom component or overlay,
  // ... etc
});
```

### Print Mode

```
runPrintMode(runtime, {mode, messages, initialMessage, initialImages}):
  1. Subscribe to agent events
  2. If mode === "json": output events as JSON lines to stdout
  3. If mode === "text": output assistant text to stdout
  4. Prompt agent with initial message
  5. Wait for agent_end
  6. Return exit code (0 = success, 1 = error)
```

Extensions still load and run in print mode, but `ctx.hasUI === false` and all UI methods are no-ops.

### RPC Mode

```
runRpcMode(runtime):
  1. Read JSONL commands from stdin
  2. Write JSONL events to stdout
  3. Commands: prompt, steer, follow_up, abort, state, model, thinking,
              queue_mode, compact, retry, bash, session, commands
  4. Extension UI dialogs forwarded as extension_ui_request events
  5. Host responds with extension_ui_response
```

## Integration Points

| Connects to | How |
|---|---|
| **Agent Session (doc 04)** | Interactive mode calls `agentSession.prompt()`, subscribes to events |
| **Extension System (doc 06)** | Provides `ExtensionUIContext`; dispatches extension commands/shortcuts |
| **Session Management (doc 07)** | Tree selector, fork, clone, session switch |
| **Tool System (doc 05)** | `renderCall` / `renderResult` from tool definitions used in ToolExecutionComponent |
| **Bootstrap (doc 01)** | Mode resolved during bootstrap; mode dispatch is final step |

## Extension Relevance

- **`ctx.hasUI`**: Always check before calling UI methods. `false` in print/JSON/RPC modes.
- **`ctx.ui.custom(factory, {overlay: true})`**: Full custom component with keyboard focus. The factory receives `(tui, theme, keybindings, done)` — call `done(result)` to dismiss.
- **`ctx.ui.setWidget(key, content, {placement})`**: Persistent widget above or below editor. Use component factory for dynamic content.
- **`ctx.ui.setFooter(factory)`**: Replace the entire footer with custom rendering.
- **`ctx.ui.setEditorComponent(factory)`**: Replace the input editor (e.g., vim mode). Extend `CustomEditor` from pi-coding-agent.
- **`ctx.ui.setWorkingIndicator({frames, intervalMs})`**: Custom spinner animation during streaming.
- **Overlays**: `custom(factory, {overlay: true, overlayOptions: {anchor: "center", width: "50%"}})` — modal overlays with positioning.
- **Theme access**: `ctx.ui.theme` for current theme colors. `ctx.ui.setTheme(name)` to switch.
- **TUI components**: Import `Text`, `Box`, `Container`, `Spacer`, `Markdown`, `Image`, `matchesKey` from `@earendil-works/pi-tui`.

## Open Questions

1. **Component lifecycle**: No formal mount/unmount lifecycle. Components are added/removed from TUI tree directly.
2. **Rendering performance**: The TUI re-renders on every agent event during streaming. Is there batching?
3. **RPC extension UI**: How well does the `extension_ui_request/response` protocol work for complex custom UIs?

## Key Files Read

| File | Lines | Purpose |
|---|---|---|
| `coding-agent/src/modes/interactive/interactive-mode.ts` | 5,145 | Full interactive mode |
| `coding-agent/src/modes/print-mode.ts` | 167 | Print + JSON mode |
| `coding-agent/src/modes/rpc/rpc-mode.ts` | ~400 | RPC mode |
| `coding-agent/src/modes/rpc/rpc-types.ts` | ~200 | RPC protocol types |
| `coding-agent/src/modes/interactive/components/` | ~30 files | All UI components |
