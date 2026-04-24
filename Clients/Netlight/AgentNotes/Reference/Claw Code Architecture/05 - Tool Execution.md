# 05 — Tool Execution

> Claw Code architecture investigation — Tool registry, dispatch, and execution subsystem.

---

## Summary

The tool execution subsystem lives primarily in `crates/tools/src/lib.rs` (~9,700 LOC) and is responsible for: building the tool manifest sent to the API, dispatching tool-use requests from the model to concrete handler functions, enforcing permissions before execution, and formatting results back into the conversation. The design uses a three-tier registry (`builtin` + `plugin` + `runtime/MCP`), a central `match`-based dispatcher, and two distinct `ToolExecutor` implementations — one for the main CLI process and one for background sub-agents.

Six process-level singleton registries (`OnceLock`) manage stateful subsystems (LSP, MCP, Team, Cron, Task, Worker) that outlive any single tool call.

---

## Key Types

| Type | Crate | Role |
|---|---|---|
| `ToolSpec` | tools | Static tool definition: name, description, JSON Schema, required permission mode |
| `GlobalToolRegistry` | tools | Combines builtin + plugin + runtime tools; produces `Vec<ToolDefinition>` for API and dispatches execution |
| `ToolManifestEntry` | tools | Manifest-level entry with `name` and `ToolSource` (Base or Conditional) |
| `ToolRegistry` | tools | Ordered list of `ToolManifestEntry` for manifest construction |
| `RuntimeToolDefinition` | tools | Dynamic tool definition for MCP-sourced tools added at runtime |
| `PluginTool` | tools | Plugin-provided tool with its own `execute` method |
| `PermissionEnforcer` | runtime | Checks permission before tool execution; holds allowed/denied sets |
| `PermissionMode` | runtime | Enum: `None`, `WorkspaceRead`, `WorkspaceWrite`, `DangerousOperation` |
| `CliToolExecutor` | main (rusty-claude-cli) | CLI's `ToolExecutor` impl — delegates to `GlobalToolRegistry.execute()` |
| `SubagentToolExecutor` | tools | Sub-agent's `ToolExecutor` impl — restricted tool set + optional enforcer |
| `ProviderRuntimeClient` | tools | `ApiClient` impl for sub-agents — provider fallback chain, sync-over-async streaming |
| `ToolDefinition` | runtime | Wire format sent to API: name, description, input_schema (referenced from doc 02) |
| `ToolExecutor` | runtime | Trait with `fn execute(&mut self, name, input) -> Result<String>` (referenced from doc 04) |
| `ApiClient` | runtime | Trait for sending requests and receiving events (referenced from doc 02) |

---

## Tool Registry & Manifest

### Three-Tier Construction

The `GlobalToolRegistry` assembles tools from three sources in priority order:

1. **Builtin tools** — `mvp_tool_specs()` returns a `Vec<ToolSpec>` with ~50 statically-defined tools. Each `ToolSpec` carries:
   - `name: &'static str`
   - `description: &'static str`
   - `input_schema: Value` (JSON Schema object)
   - `required_permission: PermissionMode`

2. **Plugin tools** — `Vec<PluginTool>` injected via `with_plugin_tools()`. Name-conflict validation prevents shadowing builtins.

3. **Runtime tools** — `Vec<RuntimeToolDefinition>` from MCP servers, injected via `with_runtime_tools()`. These are dynamic and discovered at session start.

### Registry Methods

```rust
impl GlobalToolRegistry {
    pub fn builtin() -> Self;                              // builtins only
    pub fn with_plugin_tools(self, plugins: Vec<PluginTool>) -> Self;
    pub fn with_runtime_tools(self, rt: Vec<RuntimeToolDefinition>) -> Self;
    pub fn definitions(&self) -> Vec<ToolDefinition>;      // for API request
    pub fn permission_specs(&self) -> Vec<(String, PermissionMode)>;
    pub fn execute(&self, name: &str, input: &Value) -> Result<String, String>;
    pub fn search(&self, query: &str) -> Vec<ToolSpec>;
    pub fn normalize_allowed_tools(allowed: &[String]) -> Vec<String>; // alias expansion
}
```

`definitions()` produces `Vec<ToolDefinition>` — the wire format from doc 02 that gets embedded in `MessageRequest.tools`. This is the bridge between the tool registry and the API client layer.

`normalize_allowed_tools()` expands aliases like `"read"` → `"read_file"`, `"edit"` → `"edit_file"`, `"grep"` → `"grep_search"` etc.

### Deferred Tools & Tool Search

Not all ~50 tools are sent in every API request. `deferred_tool_specs()` filters out the 6 core tools (bash, read_file, write_file, edit_file, glob_search, grep_search) from the full spec list — the remaining tools are discoverable via `ToolSearch`.

`search_tool_specs()` supports two query modes:
- **Keyword search** — tokenizes query and scores tools by canonical token matches against name + description
- **`select:` prefix** — exact name selection, e.g. `select:WebFetch,WebSearch`

### Global Singleton Registries

Six `OnceLock`-based singletons provide process-level state for stateful tool subsystems:

| Registry | Type | Purpose |
|---|---|---|
| `global_lsp_registry()` | `LspRegistry` | Language Server Protocol server connections |
| `global_mcp_registry()` | `McpToolRegistry` | MCP (Model Context Protocol) tool server connections |
| `global_team_registry()` | `TeamRegistry` | Multi-agent team coordination |
| `global_cron_registry()` | `CronRegistry` | Scheduled/periodic task execution |
| `global_task_registry()` | `TaskRegistry` | Background task tracking |
| `global_worker_registry()` | `WorkerRegistry` | Long-running worker process management |

These registries are accessed from within tool handlers and persist across tool calls within a session.

---

## Tool Dispatch Flow

### Main Dispatch Path

```
Model response (ToolUse block)
  → ConversationRuntime (doc 04) calls ToolExecutor::execute(name, input)
    → CliToolExecutor delegates to GlobalToolRegistry::execute()
      → execute_tool_with_enforcer(enforcer, name, input)
        → match name {
            "bash" => classify + enforce + run_bash(),
            "read_file" => enforce + run_read_file(),
            "write_file" => enforce + run_write_file(),
            // ... ~50 branches ...
            _ => Err("unsupported tool"),
          }
        → Result<String, String> (JSON-serialized result)
```

### Permission Enforcement

Before each tool handler runs, `maybe_enforce_permission_check()` (or the mode-variant `maybe_enforce_permission_check_with_mode()`) consults the `PermissionEnforcer`:

- **Static permission**: Most tools have a fixed `PermissionMode` from their `ToolSpec`.
- **Dynamic permission**: `bash` and `PowerShell` use `classify_bash_permission()` which downgrades to `WorkspaceWrite` if the command uses read-only operations (`cat`, `grep`, `ls`, `git status`, etc.) targeting workspace paths. Otherwise, bash commands require `DangerousOperation`.

```rust
fn classify_bash_permission(command: &str) -> PermissionMode {
    // Parses command, checks if all operations are read-only
    // and all paths are within the workspace
    // Returns WorkspaceWrite (downgraded) or DangerousOperation (default)
}
```

### Central Match Statement

`execute_tool_with_enforcer()` is a single `match` on the tool name string with ~50 arms. Each arm follows the pattern:

1. Deserialize input: `from_value::<SpecificInput>(input)?`
2. Enforce permission: `maybe_enforce_permission_check(enforcer, name, input)?`
3. Call handler: `run_specific_tool(parsed_input)`
4. Return `Result<String, String>`

Some tools (bash, Agent, Worker*, Team*, Cron*) have additional pre-dispatch logic (e.g., command classification, registry lookups, spawning threads).

---

## Individual Tool Implementations

### File Operations

| Tool | Handler | Notes |
|---|---|---|
| `read_file` | `run_read_file()` | Delegates to `runtime::read_file_contents()`, supports offset/limit |
| `write_file` | `run_write_file()` | Delegates to runtime, requires file was read first |
| `edit_file` | `run_edit_file()` | Exact string replacement with `old_string` → `new_string`, optional `replace_all` |
| `glob_search` | `run_glob_search()` | Pattern matching via runtime, sorted by modification time |
| `grep_search` | `run_grep_search()` | Ripgrep-based, supports regex, context lines, output modes |

All file tools are thin wrappers that delegate to `runtime` crate functions.

### Shell Execution

- **`bash`**: `run_bash(BashCommandInput)` — executes shell commands with optional timeout (max 600s), workspace test branch preflight check, output capture. Dynamic permission classification.
- **`PowerShell`**: Windows equivalent with similar classification logic.
- **`REPL`**: Language-specific REPL execution.

### Web Tools

- **`WebFetch`**: HTTP GET with 20-second timeout, HTML-to-text conversion, content processing. 15-minute self-cleaning cache.
- **`WebSearch`**: DuckDuckGo search with domain filtering (allowed/blocked), result parsing, markdown-formatted output.

### Agent & Sub-agent Tools

- **`Agent`**: Spawns a background sub-agent thread. Builds a `ConversationRuntime<ProviderRuntimeClient, SubagentToolExecutor>` (references doc 04's `ConversationRuntime` generic). Writes manifest and output files. Subagent types (task, research, code) get per-type tool allowlists.
- **`TaskCreate` / `TaskGet` / `TaskList` / `TaskUpdate` / `TaskStop` / `TaskOutput` / `RunTaskPacket`**: Interact with `global_task_registry()` for background task management.
- **`WorkerCreate` / `WorkerGet` / `WorkerObserve` / `WorkerResolveTrust` / `WorkerAwaitReady` / `WorkerSendPrompt` / `WorkerRestart` / `WorkerTerminate` / `WorkerObserveCompletion`**: Long-running worker lifecycle via `global_worker_registry()`.
- **`TeamCreate` / `TeamDelete`**: Multi-agent team coordination via `global_team_registry()`.
- **`CronCreate` / `CronDelete` / `CronList`**: Scheduled task management via `global_cron_registry()`.

### Structured Tools

- **`TodoWrite`**: Validates todos, persists to `.clawd-todos.json`, tracks old/new state, includes verification nudge detection.
- **`Skill`**: Multi-root skill lookup across `.claw/skills/`, `.claude/skills/`, `.omc/skills/`, `.agents/skills/`, legacy `.claude/commands/`. Supports frontmatter name matching and `fully.qualified:name` syntax.
- **`ToolSearch`**: Searches deferred tool specs by keyword or `select:` exact match. Returns tool definitions for the model to use.
- **`NotebookEdit`**: Jupyter notebook cell editing — replace, insert, delete operations with cell type support.
- **`LSP`**: Language Server Protocol operations (goToDefinition, findReferences, hover, documentSymbol, etc.) via `global_lsp_registry()`.
- **`MCP` / `ListMcpResources` / `ReadMcpResource` / `McpAuth`**: Model Context Protocol tool and resource interactions via `global_mcp_registry()`.

### Conversation Flow Tools

- **`SendUserMessage`**: Sends a message to the user mid-turn.
- **`AskUserQuestion`**: Asks the user a question and awaits response.
- **`EnterPlanMode` / `ExitPlanMode`**: Toggles plan mode for the agent.
- **`StructuredOutput`**: Returns structured JSON output.
- **`Config`**: Reads/writes configuration values.
- **`Sleep`**: Pauses execution for a specified duration.

### Supporting Modules

- **`lane_completion.rs`**: Detects when agent lanes should auto-complete. Checks: no errors, finished/completed status, no blockers, green tests, code pushed. Uses `PolicyEngine` with `CloseoutLane` and `CleanupSession` actions.
- **`pdf_extract.rs`**: Minimal PDF text extraction — locates `/Contents` stream objects, decompresses FlateDecode via `flate2`, extracts text from BT/ET operators (Tj, TJ, ', " operators). Also provides `maybe_extract_pdf_from_prompt()` for auto-detection in user prompts.

---

## Tool Result Handling

All tool handlers return `Result<String, String>`:
- **Ok(string)**: Serialized result — typically JSON via `to_pretty_json()` for structured data, or plain text for simple outputs.
- **Err(string)**: Error message string.

The conversation loop (doc 04) wraps these into `ContentBlock::ToolResult` blocks with `tool_use_id` correlation. The `CliToolExecutor` (in main.rs) maps this:

```
ToolExecutor::execute(name, input)
  → GlobalToolRegistry::execute(name, input)
    → execute_tool_with_enforcer(...)
      → Ok(json_string) or Err(error_string)
  → CliToolExecutor wraps into ToolResult for conversation
```

For sub-agents, `SubagentToolExecutor` does the same but with an `allowed_tools` guard that rejects tools not in the sub-agent's allowlist before dispatch.

---

## Integration Points

### With API Client Layer (doc 02)

- **`GlobalToolRegistry::definitions()`** produces `Vec<ToolDefinition>` — the exact type embedded in `MessageRequest.tools` (doc 02). This is how the tool manifest reaches the provider API.
- **`ProviderRuntimeClient`** implements `ApiClient` (doc 02) for sub-agents. It holds a `Vec<ProviderEntry>` for fallback chains and a `BTreeSet<String>` of allowed tools. The `stream()` method runs async streaming in a dedicated tokio runtime:
  ```rust
  struct ProviderRuntimeClient {
      runtime: tokio::runtime::Runtime,
      chain: Vec<ProviderEntry>,
      allowed_tools: BTreeSet<String>,
  }
  impl ApiClient for ProviderRuntimeClient {
      fn stream(&mut self, request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError>;
  }
  ```
- **`stream_with_provider()`** collects streaming events, handles tool input accumulation via `pending_tools: BTreeMap<u32, (String, String, String)>` (index → (id, name, input_json)), and falls back to non-streaming on empty stream responses.
- **`ToolChoice`** and `OutputContentBlock::ToolUse`** (doc 02) are the wire-format types that trigger tool dispatch.

### With Conversation Loop (doc 04)

- **`ToolExecutor` trait** (doc 04) is implemented twice:
  - `CliToolExecutor` (main.rs, line ~8650) — holds `TerminalRenderer`, `AllowedToolSet`, `GlobalToolRegistry`, optional MCP state. The primary executor for the main CLI process.
  - `SubagentToolExecutor` (tools/lib.rs) — restricted tool set, used by background agents spawned via the `Agent` tool.
- **`ConversationRuntime<C, T>`** (doc 04) is parameterized with both `ApiClient` and `ToolExecutor`. For the CLI: `ConversationRuntime<ProviderClient, CliToolExecutor>`. For sub-agents: `ConversationRuntime<ProviderRuntimeClient, SubagentToolExecutor>`.
- **`AssistantEvent`** (doc 04) carries `ToolUse` events that the conversation loop dispatches to the executor. Results flow back as `ContentBlock::ToolResult`.
- **Permission enforcement** hooks into the conversation loop's pre-execution phase — the `PermissionEnforcer` is consulted before the tool handler runs.

### With Session Management (doc 04)

- Tool execution is stateless per-call, but the global registries (LSP, MCP, Team, Cron, Task, Worker) maintain session-level state.
- Sub-agent sessions are independent — each `Agent` tool invocation creates a new `ConversationRuntime` with its own message history.
- `TodoWrite` persists to `.clawd-todos.json` which survives across turns within a session.

---

## Open Questions

1. **Plugin tool execution path**: `PluginTool` has its own `execute` method called directly, bypassing the central `match` dispatcher. How are plugin permissions enforced? Is there a separate enforcer integration?
2. **MCP tool execution**: Runtime tools from MCP are dispatched through the `match` default arm (`_ => Err("unsupported tool")`). How do MCP tool calls actually reach their servers — is there a pre-dispatch intercept in `GlobalToolRegistry::execute()`?
3. **Tool result size limits**: No truncation or size limiting is visible in the dispatch path. Are large tool results (e.g., reading a huge file) truncated before being sent to the API?
4. **Concurrent tool execution**: The conversation loop (doc 04) executes tools sequentially. Is there a planned or existing path for parallel tool execution?
5. **CliToolExecutor details**: Located in main.rs (~line 8650) rather than the tools crate. The full implementation details (MCP integration, terminal rendering hooks) were not read in this investigation.
6. **Error recovery**: When a tool handler panics (e.g., flate2 decompression failure in pdf_extract), how does the dispatch path recover? Is there a catch_unwind or similar safety net?

---

## Key Files Read

| File | Lines | Purpose |
|---|---|---|
| `rust/crates/tools/src/lib.rs` | ~9,686 | Core tool registry, dispatch, all handlers, sub-agent executor, provider client |
| `rust/crates/tools/src/lane_completion.rs` | 182 | Lane auto-completion detection and policy evaluation |
| `rust/crates/tools/src/pdf_extract.rs` | ~250 | Minimal PDF text extraction for user prompts |
| `rust/crates/rusty-claude-cli/src/main.rs` | (searched) | Contains `CliToolExecutor` at ~line 8650 |
