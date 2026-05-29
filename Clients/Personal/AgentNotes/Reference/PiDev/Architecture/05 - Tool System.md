# 05 — Tool System

## Summary

Pi ships with 7 built-in tools: `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`. Each is defined in its own file under `coding-agent/src/core/tools/`, following the `ToolDefinition` interface from the extension system. Tools are stateless per-call but share a `FileMutationQueue` for serializing file writes. Extension tools use the same `ToolDefinition` shape and are treated identically by the agent loop.

## Key Types & Interfaces

### Tool Definitions (`tools/index.ts`)

| Type | Description |
|---|---|
| `ToolDefinition<TParams, TDetails, TState>` | Full tool def: `name`, `label`, `description`, `promptSnippet?`, `promptGuidelines?`, `parameters` (TypeBox), `renderShell?`, `prepareArguments?`, `executionMode?`, `execute()`, `renderCall?`, `renderResult?` |
| `AgentToolResult<T>` | `{content: (TextContent \| ImageContent)[], details: T}` |
| `AgentToolUpdateCallback<T>` | Streaming update callback |

### Built-in Tool Input/Details Types

| Tool | Input Type | Details Type | Key Params |
|---|---|---|---|
| `bash` | `BashToolInput` | `BashToolDetails` | `command`, `timeout?` |
| `read` | `ReadToolInput` | `ReadToolDetails` | `path`, `offset?`, `limit?` |
| `write` | `WriteToolInput` | — | `path`, `content` |
| `edit` | `EditToolInput` | `EditToolDetails` | `path`, `edits: [{oldText, newText}]` |
| `grep` | `GrepToolInput` | `GrepToolDetails` | `pattern`, `path?`, `include?` |
| `find` | `FindToolInput` | `FindToolDetails` | `pattern`, `path?`, `type?` |
| `ls` | `LsToolInput` | `LsToolDetails` | `path?` |

### File Mutation Queue

| Type | Description |
|---|---|
| `FileMutationQueue` | Serializes write/edit operations per file path. Multiple tools can read concurrently, but writes are queued. |

## Tool Implementations

### bash (`tools/bash.ts`)

- Executes shell commands via `BashExecutor`
- Default timeout: 120s, max: 600s
- Uses `executeBashWithOperations()` which supports `BashOperations` interface for custom execution (e.g., SSH via extension)
- Output is truncated with `truncateHead()` / `truncateTail()` at configurable limits
- Streams partial output via `onUpdate` callback
- `createLocalBashOperations()` creates the default local executor

### read (`tools/read.ts`)

- Reads text files and images
- Supports `offset` (line number) and `limit` (max lines)
- Images returned as `ImageContent` (base64)
- Auto-detects binary files
- Output truncated at 2000 lines or 50KB

### write (`tools/write.ts`)

- Creates/overwrites files
- Auto-creates parent directories
- Goes through `FileMutationQueue`

### edit (`tools/edit.ts`)

- Surgical text replacement: `edits: [{oldText, newText}]`
- Each `oldText` must be unique in the file
- Produces diff details via `edit-diff.ts` for rendering
- Goes through `FileMutationQueue`

### grep (`tools/grep.ts`)

- Uses `ripgrep` (rg) under the hood via bash
- Respects `.gitignore`
- Supports regex, file type filters, context lines

### find (`tools/find.ts`)

- Uses `find` command or `fd` if available
- Respects `.gitignore` when using `fd`
- Supports file type and pattern filters

### ls (`tools/ls.ts`)

- Directory listing with file sizes and types
- Tree-style output

### Tool Definition Wrapper (`tool-definition-wrapper.ts`)

- `createToolDefinitionFromAgentTool()`: wraps a plain `AgentTool` (from SDK/base tools override) into a full `ToolDefinition` with synthetic source info
- Used when `baseToolsOverride` is provided in `AgentSessionConfig`

### Path Utilities (`path-utils.ts`)

- `resolvePath(path, cwd)`: resolves relative paths, expands `~`
- Shared across all file-operating tools

### Truncation (`truncate.ts`)

- `truncateHead(text, maxLines, maxBytes)`: keeps last N lines
- `truncateTail(text, maxLines, maxBytes)`: keeps first N lines
- Used by bash (output), read (file content)

## Flow

### Tool Registration

```
AgentSession constructor:
  1. createAllToolDefinitions(cwd) → 7 built-in ToolDefinitions
  2. extensionRunner.getAllRegisteredTools() → extension ToolDefinitions
  3. wrapRegisteredTools() → convert to AgentTool[] with extension execute wrapper
  4. Merge: built-in + extension tools (extension can override by same name)
  5. Apply allowedToolNames filter if provided
  6. Set agent.state.tools
```

### Tool Execution (from agent loop)

```
Agent loop calls tool.execute(toolCallId, params, signal, onUpdate):
  1. ToolDefinition.execute(toolCallId, params, signal, onUpdate, ctx)
     - Built-in tools: direct implementation
     - Extension tools: wrapped to pass ExtensionContext as 5th arg
  2. Returns AgentToolResult<TDetails>
  3. Agent loop wraps into ToolResultMessage
```

### Extension Tool Wrapping

Extension tools are defined via `pi.registerTool()`. The `wrapRegisteredTools()` function in `extensions/index.ts` wraps each `ToolDefinition` into an `AgentTool` by:
1. Binding the `execute` call to include `ExtensionContext`
2. Preserving `renderCall` / `renderResult` for UI
3. Copying `prepareArguments`, `executionMode`, `renderShell`

## Integration Points

| Connects to | How |
|---|---|
| **Agent Core (doc 03)** | Tools are `AgentTool[]` on `agent.state.tools`; loop calls `.execute()` |
| **Agent Session (doc 04)** | Session creates tool definitions, manages active set |
| **Extension System (doc 06)** | Extension tools registered via `pi.registerTool()`, wrapped into `AgentTool` |
| **System Prompt (doc 09)** | Tool `promptSnippet` and `promptGuidelines` injected into system prompt |
| **Modes (doc 10)** | `renderCall` / `renderResult` used by interactive mode for TUI rendering |

## Extension Relevance

- **Register tools**: `pi.registerTool({name, label, description, parameters, execute, ...})` — 5th arg to `execute` is `ExtensionContext`.
- **Override built-in tools**: Register with the same name (e.g., `"read"`) to replace.
- **Tool schema**: Use `@sinclair/typebox` for `parameters`. Use `StringEnum` from `@earendil-works/pi-ai` for Google compatibility.
- **Streaming results**: Call `onUpdate({content, details})` during execution for live UI updates.
- **Custom rendering**: `renderCall` and `renderResult` receive TUI `Theme` and `ToolRenderContext` for custom UI.
- **`renderShell: "self"`**: Opt out of the default colored tool execution shell; the tool controls its own framing.
- **`executionMode: "sequential"`**: Force this tool to run one-at-a-time even when parallel execution is enabled.
- **`promptSnippet`**: One-line description added to "Available tools" in system prompt. Custom tools without this are invisible to the system prompt.
- **`promptGuidelines`**: Bullet points appended to the Guidelines section.

## Open Questions

1. **FileMutationQueue scope**: Is it per-session or global? If two sessions edit the same file, is there contention?
2. **Tool output limits**: bash truncates at ~50KB; read at 2000 lines / 50KB. Are these configurable?
3. **grep/find fallback**: If `rg` / `fd` aren't installed, do grep/find fall back to standard Unix tools?

## Key Files Read

| File | Lines | Purpose |
|---|---|---|
| `coding-agent/src/core/tools/index.ts` | 196 | Tool creation, type exports |
| `coding-agent/src/core/tools/bash.ts` | ~400 | Bash tool + executor |
| `coding-agent/src/core/tools/read.ts` | ~300 | Read tool |
| `coding-agent/src/core/tools/write.ts` | ~150 | Write tool |
| `coding-agent/src/core/tools/edit.ts` | ~350 | Edit tool + diff |
| `coding-agent/src/core/tools/edit-diff.ts` | ~200 | Diff computation |
| `coding-agent/src/core/tools/grep.ts` | ~200 | Grep tool |
| `coding-agent/src/core/tools/find.ts` | ~200 | Find tool |
| `coding-agent/src/core/tools/ls.ts` | ~150 | Ls tool |
| `coding-agent/src/core/tools/file-mutation-queue.ts` | ~100 | Write serialization |
| `coding-agent/src/core/tools/truncate.ts` | ~80 | Output truncation |
| `coding-agent/src/core/tools/tool-definition-wrapper.ts` | ~100 | AgentTool ↔ ToolDefinition |
