# 08 — MCP (Model Context Protocol)

> Claw Code architecture investigation — MCP client, server, transport, lifecycle, and tool bridge subsystems.

---

## Summary

Claw acts as **both an MCP client and an MCP server**. As a client, it connects to external MCP servers (currently only stdio transport is fully implemented), discovers their tools and resources at session startup, and bridges those tools into the `GlobalToolRegistry` (doc 05) as `RuntimeToolDefinition` entries visible to the model. As a server, it exposes a minimal stdio-based JSON-RPC server (`McpServer`) that answers `initialize`, `tools/list`, and `tools/call` requests, allowing external MCP clients (e.g. Claude Desktop) to drive claw's tools. The MCP subsystem spans six source files across the `runtime` crate, with orchestration in `main.rs` and tool dispatch in the `tools` crate.

---

## Key Types & Structs

| Type | File | Role |
|---|---|---|
| `McpServerConfig` | config.rs | Enum: `Stdio`, `Sse`, `Http`, `Ws`, `Sdk`, `ManagedProxy` — parsed from `mcpServers` config |
| `ScopedMcpServerConfig` | config.rs | MCP server config paired with its `ConfigSource` scope |
| `McpConfigCollection` | config.rs | Collection of all configured MCP servers after scope-aware merging |
| `McpTransport` | config.rs | Enum: `Stdio`, `Sse`, `Http`, `Ws`, `Sdk`, `ManagedProxy` |
| `McpClientBootstrap` | mcp_client.rs | Pre-resolved connection target: server name, normalized name, tool prefix, signature, transport |
| `McpClientTransport` | mcp_client.rs | Enum: `Stdio`, `Sse`, `Http`, `WebSocket`, `Sdk`, `ManagedProxy` — transport-specific connection details |
| `McpStdioTransport` | mcp_client.rs | Stdio transport details: command, args, env, tool_call_timeout_ms |
| `McpRemoteTransport` | mcp_client.rs | Remote transport: url, headers, headers_helper, auth |
| `McpClientAuth` | mcp_client.rs | Enum: `None`, `OAuth(McpOAuthConfig)` |
| `McpStdioProcess` | mcp_stdio.rs | Wrapper around a spawned child process with LSP-framed stdin/stdout |
| `McpServerManager` | mcp_stdio.rs | Manages multiple `ManagedMcpServer` instances, routes tool calls, handles discovery |
| `ManagedMcpServer` | mcp_stdio.rs | Internal: bootstrap config + optional process + initialized flag |
| `ManagedMcpTool` | mcp_stdio.rs | Discovered tool: server_name, qualified_name (`mcp__server__tool`), raw_name, tool descriptor |
| `McpToolDiscoveryReport` | mcp_stdio.rs | Discovery result: tools, failed servers, unsupported servers, degraded report |
| `McpServerManagerError` | mcp_stdio.rs | Error enum: Io, Transport, JsonRpc, InvalidResponse, Timeout, UnknownTool, UnknownServer |
| `McpDiscoveryFailure` | mcp_stdio.rs | Per-server failure: server_name, phase, error string, recoverable flag, context map |
| `UnsupportedMcpServer` | mcp_stdio.rs | Server that uses an unsupported transport (non-stdio currently) |
| `JsonRpcRequest<T>` | mcp_stdio.rs | JSON-RPC 2.0 request with typed params |
| `JsonRpcResponse<T>` | mcp_stdio.rs | JSON-RPC 2.0 response with typed result and optional error |
| `JsonRpcId` | mcp_stdio.rs | Enum: `Number(u64)`, `String(String)`, `Null` |
| `JsonRpcError` | mcp_stdio.rs | JSON-RPC error: code, message, optional data |
| `McpTool` | mcp_stdio.rs | MCP tool descriptor: name, description, inputSchema, annotations, _meta |
| `McpToolCallParams` | mcp_stdio.rs | tools/call request params: name, arguments, _meta |
| `McpToolCallResult` | mcp_stdio.rs | tools/call result: content blocks, structuredContent, isError, _meta |
| `McpToolCallContent` | mcp_stdio.rs | Content block: type + flattened data (text, image, etc.) |
| `McpResource` | mcp_stdio.rs | MCP resource descriptor: uri, name, description, mimeType, annotations |
| `McpResourceContents` | mcp_stdio.rs | Resource content: uri, mimeType, text, blob |
| `McpLifecyclePhase` | mcp_lifecycle_hardened.rs | Enum of 11 lifecycle phases from ConfigLoad through Cleanup |
| `McpLifecycleState` | mcp_lifecycle_hardened.rs | Tracks current phase, per-phase errors/timestamps/results |
| `McpLifecycleValidator` | mcp_lifecycle_hardened.rs | State machine that validates and records phase transitions |
| `McpPhaseResult` | mcp_lifecycle_hardened.rs | Enum: `Success`, `Failure`, `Timeout` with phase and duration/error |
| `McpErrorSurface` | mcp_lifecycle_hardened.rs | Structured error: phase, server_name, message, context map, recoverable flag, timestamp |
| `McpDegradedReport` | mcp_lifecycle_hardened.rs | Degraded startup: working/failed servers, available/missing tools |
| `McpFailedServer` | mcp_lifecycle_hardened.rs | Server failure record: name, phase, error surface |
| `McpToolRegistry` | mcp_tool_bridge.rs | Process-level singleton (`global_mcp_registry()`) — tracks server states, delegates tool calls |
| `McpConnectionStatus` | mcp_tool_bridge.rs | Enum: `Disconnected`, `Connecting`, `Connected`, `AuthRequired`, `Error` |
| `McpServerState` | mcp_tool_bridge.rs | Tracked server: name, status, tools, resources, server_info, error_message |
| `McpToolInfo` | mcp_tool_bridge.rs | Tool metadata cached in the bridge: name, description, input_schema |
| `McpResourceInfo` | mcp_tool_bridge.rs | Resource metadata cached in the bridge: uri, name, description, mime_type |
| `McpServer` | mcp_server.rs | Minimal MCP server: dispatches initialize, tools/list, tools/call over stdio |
| `McpServerSpec` | mcp_server.rs | Server config: server_name, server_version, tools, tool_handler |
| `ToolCallHandler` | mcp_server.rs | `Box<dyn Fn(&str, &JsonValue) -> Result<String, String>>` |
| `RuntimeMcpState` | main.rs | CLI-level orchestration: tokio runtime, McpServerManager, pending servers, degraded report |
| `RuntimeToolDefinition` | tools/lib.rs | Dynamic tool definition for MCP-sourced tools: name, description, input_schema, required_permission |

---

## MCP Architecture (Client vs Server Roles)

### Claw as MCP Client

This is the **primary** role. Claw connects to external MCP servers configured in `mcpServers` blocks across config files (user, project, local scopes — merged with scope-aware precedence). At session startup:

1. `McpServerManager::from_runtime_config()` reads the merged MCP config
2. Each server config is resolved into an `McpClientBootstrap` with transport details
3. Only **stdio** transport servers are registered; all others are marked as `UnsupportedMcpServer`
4. `discover_tools_best_effort()` iterates servers, spawns processes, initializes, and discovers tools
5. Discovered tools become `RuntimeToolDefinition` entries in `GlobalToolRegistry`
6. The model sees them as regular tools with names like `mcp__serverName__toolName`

### Claw as MCP Server

Claw can also **expose itself** as an MCP server via `McpServer` in `mcp_server.rs`. This allows external MCP clients (e.g. Claude Desktop) to call claw's tools through the MCP protocol. The server:

- Runs a blocking read/dispatch/write loop over stdin/stdout
- Handles `initialize`, `tools/list`, and `tools/call` JSON-RPC methods
- Delegates tool execution to a caller-supplied `ToolCallHandler` closure
- Advertises protocol version `2025-03-26`
- The server is intentionally minimal — it exposes pre-built `McpTool` descriptors and delegates actual execution

---

## Transport Layer (Stdio Transport)

### Message Framing

Both client and server use **LSP-style Content-Length framing** over stdio pipes:

```
Content-Length: <byte-count>\r\n
\r\n
<JSON-RPC payload bytes>
```

The framing is implemented symmetrically:

- **Client side** (`McpStdioProcess::write_frame` / `read_frame`): Reads headers line by line until `\r\n`, extracts `Content-Length` (case-insensitive header name match), then reads exactly that many bytes. Writing prepends the header.

- **Server side** (`mcp_server.rs::read_frame` / `write_response`): Identical framing logic using `BufReader<Stdin>` and `Stdout`.

### JSON-RPC 2.0

All messages follow JSON-RPC 2.0:
- Requests have `jsonrpc: "2.0"`, `id`, `method`, optional `params`
- Responses have `jsonrpc: "2.0"`, `id`, optional `result`, optional `error`
- Notifications (no `id`) are silently consumed by the server with no response
- Error codes follow the spec: `-32700` (parse error), `-32600` (invalid request), `-32601` (method not found), `-32602` (invalid params)

### Transport Variants (Config Level)

Six transport types are configured but only **stdio** is operational in `McpServerManager`:

| Transport | Config Type | Status |
|---|---|---|
| `Stdio` | `McpStdioServerConfig` (command, args, env, tool_call_timeout_ms) | **Fully implemented** |
| `Sse` | `McpRemoteServerConfig` (url, headers, headers_helper, oauth) | Config parsed, marked unsupported at runtime |
| `Http` | `McpRemoteServerConfig` (same structure) | Config parsed, marked unsupported at runtime |
| `Ws` | `McpWebSocketServerConfig` (url, headers, headers_helper) | Config parsed, marked unsupported at runtime |
| `Sdk` | `McpSdkServerConfig` (name) | Config parsed, marked unsupported at runtime |
| `ManagedProxy` | `McpManagedProxyServerConfig` (url, id) | Config parsed, marked unsupported at runtime |

### Process Spawning

`McpStdioProcess::spawn()`:
1. Creates a `tokio::process::Command` with the configured command and args
2. Pipes stdin and stdout; inherits stderr
3. Applies environment variables from the config
4. Returns a wrapper holding `Child`, `ChildStdin`, and `BufReader<ChildStdout>`

### Error Handling

- **Transport errors** (`McpServerManagerError::Transport`): I/O errors during communication
- **Timeout errors** (`McpServerManagerError::Timeout`): Configurable per-method timeouts:
  - Initialize: 10 seconds (200ms in tests)
  - tools/list: 30 seconds (300ms in tests)
  - tools/call: Configurable per server (`tool_call_timeout_ms`), default 60 seconds
- **InvalidData errors**: Mapped to `McpServerManagerError::InvalidResponse` — indicates malformed JSON or protocol violations
- **Response ID validation**: Client verifies `response.id` matches `request.id`, rejects mismatches

---

## Server Lifecycle

### Startup Sequence

In `main.rs`, `RuntimeMcpState::new()` orchestrates the startup:

```
RuntimeConfig.mcp().servers()
  → McpServerManager::from_runtime_config()
    → For each server:
        - Stdio → McpClientBootstrap → ManagedMcpServer (not yet spawned)
        - Non-stdio → UnsupportedMcpServer
  → discover_tools_best_effort()
    → For each managed server:
        → ensure_server_ready()
          → spawn_mcp_stdio_process() (if no process)
          → initialize handshake (if not initialized)
        → tools/list (paginated with cursor)
        → Build ManagedMcpTool entries
    → On failure: record McpDiscoveryFailure, continue with remaining servers
  → Build McpToolDiscoveryReport (tools, failures, unsupported, degraded_startup)
```

### Lazy Initialization (ensure_server_ready)

The `ensure_server_ready()` method is called before every operation (discover, call_tool, list_resources, read_resource):

1. Check if the server process has exited (`try_wait`) — if so, reset
2. If no process exists, spawn one
3. If not initialized, send `initialize` request
4. Mark as initialized on success

This means servers are spawned on-demand and re-spawned if they crash.

### Retry Logic

Operations that hit retryable errors (`Transport` or `Timeout`) get **one** automatic retry:
- The failed server is reset (process killed, initialized flag cleared)
- A new process is spawned on the next attempt
- If the retry also fails, the error propagates

The `should_reset_server()` check also triggers reset for `InvalidResponse` errors (indicating protocol corruption).

### Shutdown

`McpServerManager::shutdown()`:
1. Iterates all managed servers
2. For each with a live process: calls `process.shutdown()`
3. `shutdown()` checks `try_wait()`, kills if still running, waits for exit
4. Clears process and initialized flag

The CLI orchestrates this through `BuiltRuntime::shutdown_mcp()` and through the `Drop` impl which ensures MCP cleanup on process exit.

### Degraded Mode

When some servers fail but others succeed, a `McpDegradedReport` is generated:
- Lists working and failed servers
- Tracks available vs. missing tools
- This report is surfaced to the model via `ToolSearch` results, so the model knows which MCP servers/tools are unavailable

---

## Hardened Lifecycle (mcp_lifecycle_hardened.rs)

### Phase State Machine

The lifecycle defines 11 ordered phases:

```
ConfigLoad → ServerRegistration → SpawnConnect → InitializeHandshake
  → ToolDiscovery → ResourceDiscovery (optional) → Ready
  → Invocation ↔ Ready
  → ErrorSurfacing → Ready (if recoverable) or Shutdown
  → Shutdown → Cleanup
```

Key transition rules:
- Must start at `ConfigLoad`
- `ResourceDiscovery` can be skipped (ToolDiscovery → Ready is valid)
- `Ready ↔ Invocation` supports the steady-state cycle
- Any phase (except Cleanup/Shutdown) can transition to `ErrorSurfacing`
- Any phase (except Cleanup) can transition to `Shutdown`
- `ErrorSurfacing → Ready` is only allowed if the last error was **recoverable**

### McpLifecycleValidator

Provides three recording methods:
- `run_phase(phase)` — validates transition, records success with duration
- `record_failure(error)` — records error, transitions to ErrorSurfacing
- `record_timeout(phase, waited, server_name, context)` — records timeout (always marked recoverable)

### McpErrorSurface

Structured error representation with:
- `phase` — which lifecycle phase failed
- `server_name` — optional, which server caused the error
- `message` — human-readable error description
- `context` — `BTreeMap<String, String>` of key-value context (e.g., io_kind, method, timeout_ms)
- `recoverable` — whether the system can resume after this error
- `timestamp` — epoch seconds when the error occurred

### Error-to-Phase Mapping

`McpServerManagerError` maps to lifecycle phases:
- `Io` → SpawnConnect
- `Transport`/`JsonRpc`/`InvalidResponse`/`Timeout` → determined by the MCP method name
  - `initialize` → InitializeHandshake
  - `tools/list` → ToolDiscovery
  - `resources/list` → ResourceDiscovery
  - `tools/call`/`resources/read` → Invocation
- `UnknownTool` → ToolDiscovery
- `UnknownServer` → ServerRegistration

Recoverability: Transport and Timeout errors are recoverable unless they occur during InitializeHandshake.

---

## Tool Bridge (mcp_tool_bridge.rs)

### McpToolRegistry (Global Singleton)

`global_mcp_registry()` returns a process-level `OnceLock<McpToolRegistry>` — one of six global registries from doc 05.

The `McpToolRegistry` provides two parallel paths for tool execution:

**Path 1: Static metadata (used by the `tools` crate)**
- `register_server()` — stores `McpServerState` with cached tool/resource metadata
- `list_tools()`, `list_resources()`, `read_resource()` — reads from cached state
- Used by `run_list_mcp_resources()`, `run_read_mcp_resource()`, `run_mcp_auth()`, `run_mcp_tool()` in the `tools` crate

**Path 2: Live tool calls (via McpServerManager)**
- `set_manager()` — injects `Arc<Mutex<McpServerManager>>` once at startup
- `call_tool(server, tool, args)` — validates server is connected, tool exists, then delegates to `spawn_tool_call()`
- `spawn_tool_call()` creates a **new OS thread** with a **fresh tokio current-thread runtime**, acquires the manager lock, calls `discover_tools()` + `call_tool()` + `shutdown()`, then returns the result

### Two Dispatch Paths in the CLI

The `CliToolExecutor` (main.rs line ~8650) has a two-tier dispatch:

```
ToolExecutor::execute(name, input)
  → if name == "ToolSearch": execute_search_tool()
  → else if tool_registry.has_runtime_tool(name): execute_runtime_tool()
    → "MCPTool" / "ListMcpResourcesTool" / "ReadMcpResourceTool": wrapper tools
    → _ (any other runtime tool name): direct mcp_state.call_tool(name, args)
  → else: tool_registry.execute(name, input) (builtin tools)
```

This means MCP tools are dispatched through the runtime tool path, **not** through the central `match` dispatcher in the `tools` crate.

---

## Tool Naming Convention

MCP tools use a namespaced naming scheme:

```
mcp__{normalized_server_name}__{normalized_tool_name}
```

`normalize_name_for_mcp()` replaces non-alphanumeric characters (except `_` and `-`) with underscores. For `claude.ai` prefixed server names, consecutive underscores are collapsed and leading/trailing underscores are stripped.

Example: server `"github.com"` + tool `"search repos"` → `mcp__github_com__search_repos`

### Server Signatures

`mcp_server_signature()` generates a stable identity string for config deduplication:
- Stdio: `stdio:[command|arg1|arg2]`
- SSE/Http/Ws/ManagedProxy: `url:{unwrapped_url}` (CCR proxy URLs are unwrapped to the original `mcp_url` query parameter)
- Sdk: `None` (no signature)

`scoped_mcp_config_hash()` produces a deterministic FNV-1a hex hash of the full config (ignoring scope), used for config change detection.

---

## Client Implementation

### How Claw Connects to External MCP Servers

1. **Configuration**: `mcpServers` blocks in config files define servers. Parsed by `config.rs`, merged across scopes (User, Project, Local).

2. **Bootstrap**: `McpClientBootstrap::from_scoped_config()` resolves each `ScopedMcpServerConfig` into a connection target with normalized name, tool prefix, and transport details.

3. **Manager**: `McpServerManager::from_servers()` creates `ManagedMcpServer` entries for stdio servers, marks others as unsupported.

4. **Discovery**: `discover_tools_best_effort()` spawns processes, initializes via JSON-RPC, lists tools with cursor-based pagination.

5. **Tool Registration**: Discovered `ManagedMcpTool` entries are converted to `RuntimeToolDefinition` via `mcp_runtime_tool_definition()`, which:
   - Sets `name` to the qualified name (`mcp__server__tool`)
   - Copies description and input_schema from the MCP tool descriptor
   - Derives `PermissionMode` from tool annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`)

6. **Wrapper tools**: If any MCP servers are configured, three additional wrapper tools are registered:
   - `MCPTool` — call any MCP tool by qualified name (DangerFullAccess permission)
   - `ListMcpResourcesTool` — list resources from one or all servers (ReadOnly)
   - `ReadMcpResourceTool` — read a specific resource (ReadOnly)

### Permission Mapping from MCP Annotations

`permission_mode_for_mcp_tool()` reads annotation hints:

| readOnlyHint | destructiveHint | openWorldHint | → PermissionMode |
|---|---|---|---|
| true | false | false | ReadOnly |
| any | true | any | DangerFullAccess |
| any | any | true | DangerFullAccess |
| false | false | false | WorkspaceWrite (default) |

---

## Server Implementation

### McpServer (mcp_server.rs)

Claw implements a minimal MCP server that can be driven by external clients:

**Protocol**: JSON-RPC 2.0 over LSP-framed stdio (same framing as the client transport).

**Supported methods**:
- `initialize` — returns protocol version `2025-03-26`, server name/version, and `{ "tools": {} }` capabilities
- `tools/list` — returns the pre-configured `Vec<McpTool>` descriptors
- `tools/call` — deserializes `McpToolCallParams`, invokes the `ToolCallHandler`, wraps result in `McpToolCallResult` with a single text content block

**Error handling**:
- Parse errors → JSON-RPC error code -32700 with null id
- Invalid requests → -32600
- Unknown methods → -32601
- Invalid params → -32602
- Handler errors → `isError: true` in the tool call result (not a JSON-RPC error)

**Notifications**: Messages without an `id` field are silently consumed (no response sent), per the JSON-RPC 2.0 spec.

**Lifecycle**: The server runs until the client closes stdin (EOF), at which point `run()` returns `Ok(())`.

---

## Integration Points

### With Tool Execution (doc 05)

- **`RuntimeToolDefinition`** (doc 05): MCP-discovered tools are injected via `GlobalToolRegistry::with_runtime_tools()`. They appear alongside builtin and plugin tools in `definitions()` output sent to the API.
- **`global_mcp_registry()`** (doc 05): One of six `OnceLock` singletons. The `McpToolRegistry` in the `tools` crate provides the alternative dispatch path for MCP tools through `run_mcp_tool()`, `run_list_mcp_resources()`, `run_read_mcp_resource()`, and `run_mcp_auth()`.
- **Dispatch routing**: The `CliToolExecutor` checks `has_runtime_tool(name)` before the builtin `match` dispatcher. All MCP tools (both qualified-name tools and wrapper tools) are routed through `execute_runtime_tool()` which delegates to `RuntimeMcpState`.
- **Two parallel registries**: The `McpToolRegistry` (tool bridge, tools crate) and `RuntimeMcpState` (main.rs) both hold references to the `McpServerManager`. The bridge is used for the tools-crate dispatch path; `RuntimeMcpState` is used for the CLI executor path. Tool calls from `McpToolRegistry` spawn a separate OS thread with a fresh tokio runtime.

### With Plugin & Hook System (doc 07)

- **Parallel lifecycle models**: Doc 07 identified `PluginLifecycle` (runtime crate) as a more sophisticated lifecycle than the plugins crate's simple Init/Shutdown. The MCP lifecycle in `mcp_lifecycle_hardened.rs` is a **third, independent lifecycle model** specifically for MCP servers — with 11 phases, a state machine validator, and structured error surfacing. It is not integrated with the plugin lifecycle system.
- **Plugins cannot import MCP servers**: Doc 07 noted that `detect_claude_code_manifest_contract_gaps()` rejects `mcpServers` in plugin manifests — claw does not allow plugins to contribute MCP server configurations.
- **Hook integration**: MCP tool calls go through the same `ToolExecutor::execute()` path in the conversation loop, so pre/post tool-use hooks (doc 07) fire around MCP tool invocations just like any other tool.
- **`RuntimeFeatureConfig`** (doc 07): Holds `RuntimeHookConfig` + `RuntimePluginConfig` + MCP config. Built during `build_runtime_plugin_state_with_loader()` which constructs both plugin and MCP state together.

### With Configuration (doc 01 reference)

- MCP servers are configured under `mcpServers` keys in config files
- Scope-aware merging: User < Project < Local, with later scopes overriding
- Parsed by `merge_mcp_servers()` in `config.rs`, which iterates `mcpServers` object entries and dispatches to transport-specific parsers
- Transport type is inferred from the `type` field: `"stdio"`, `"sse"`, `"http"`, `"ws"`, `"sdk"`, `"claudeai-proxy"`
- HTTP can also be auto-inferred from URL-only configs

---

## Open Questions

1. **Stdio-only transport limitation**: The `McpServerManager` only supports stdio transport. SSE, HTTP, WebSocket, SDK, and ManagedProxy are all parsed from config but marked as `UnsupportedMcpServer` at runtime. Is there a planned implementation path for remote transports, or is this an intentional design choice (matching Claude Code's current behavior)?

2. **Dual registry confusion**: Both `McpToolRegistry` (tool bridge, tools crate) and `RuntimeMcpState` (main.rs) provide tool-call dispatch paths. The tool bridge spawns a separate OS thread and tokio runtime for each call, while `RuntimeMcpState` uses a shared tokio runtime. Which path is actually used in practice? The `CliToolExecutor` uses `RuntimeMcpState` for all runtime tools, so the tool bridge's `spawn_tool_call` path appears to be the alternative used only when calling through `global_mcp_registry()`.

3. **Lifecycle validator integration**: `McpLifecycleValidator` and `McpLifecycleState` provide a rigorous state machine with phase transition validation, but the `McpServerManager` does not use them directly. The phases are referenced in error classification (`lifecycle_phase_for_method`), degraded reports, and discovery failures, but there is no running `McpLifecycleValidator` instance tracking the actual server lifecycle. Is this a planned integration or is the validator intended only for testing/validation?

4. **Server re-discovery during tool calls**: The `McpToolRegistry::spawn_tool_call()` path calls `manager.discover_tools().await` before `manager.call_tool()` and then `manager.shutdown()` after every single tool call. This means it re-initializes the server process, re-discovers tools, calls the tool, and shuts down — per call. This seems expensive. Is this an intentional safety measure, or a placeholder for a more persistent connection model?

5. **MCP server exposure**: `McpServer` exists and handles initialize/tools/list/tools/call, but how is it actually invoked? The integration point in `main.rs` where `McpServer::run()` is called was not examined. What triggers claw to operate in "MCP server mode" vs. normal CLI mode?

6. **Resource management**: The resource API (`list_resources`, `read_resource`) is implemented in `McpServerManager` with retry logic, but the `McpToolRegistry` bridge only caches resource metadata from initial registration. Live resource operations (listing/reading) are handled through `RuntimeMcpState` in the CLI executor. Is the tool-bridge resource cache kept in sync with the actual server state?

7. **OAuth flow**: `McpClientAuth::OAuth` is modeled for SSE and HTTP transports, but since those transports are not supported by `McpServerManager`, the OAuth flow has no operational path. Is there a separate OAuth implementation outside the runtime crate?

8. **CCR proxy URL unwrapping**: `unwrap_ccr_proxy_url()` handles Anthropic's session ingress proxy URLs by extracting the `mcp_url` query parameter. This is used in signature computation for deduplication. Is this specific to Claude Desktop's managed MCP server connections?

9. **No health checks or heartbeats**: The lifecycle hardening module defines health-oriented phases (Ready, ErrorSurfacing) but `McpServerManager` only checks if a server process has exited (`try_wait`). There are no periodic health checks, keepalive pings, or heartbeat mechanisms. Is the "check on use" model sufficient?

10. **Plugin lifecycle overlap**: Doc 07 identified three lifecycle models: plugins crate (Init/Shutdown), runtime crate (`PluginLifecycle` trait with healthchecks), and now MCP lifecycle (11 phases). These are all independent. Is there a consolidation plan?

---

## Key Files Read

| File | Lines | Purpose |
|---|---|---|
| `rust/crates/runtime/src/mcp.rs` | ~305 | Tool naming (`mcp__server__tool`), server signatures, config hashing, CCR proxy URL unwrapping |
| `rust/crates/runtime/src/mcp_client.rs` | ~249 | Client bootstrap types, transport variants, auth model, `McpClientBootstrap::from_scoped_config` |
| `rust/crates/runtime/src/mcp_server.rs` | ~441 | Minimal MCP server: JSON-RPC dispatch over LSP-framed stdio, initialize/tools/list/tools/call handlers |
| `rust/crates/runtime/src/mcp_stdio.rs` | ~1500+ | `McpStdioProcess` (process wrapper, frame I/O, JSON-RPC methods), `McpServerManager` (multi-server management, discovery, retry, shutdown) |
| `rust/crates/runtime/src/mcp_lifecycle_hardened.rs` | ~700 | `McpLifecyclePhase` state machine, `McpLifecycleValidator`, `McpErrorSurface`, `McpDegradedReport`, `McpFailedServer` |
| `rust/crates/runtime/src/mcp_tool_bridge.rs` | ~700 | `McpToolRegistry` singleton, `McpConnectionStatus`, `McpServerState`, live tool calls via thread-per-call + tokio runtime |
| `rust/crates/runtime/src/config.rs` | (searched) | `McpConfigCollection`, `McpServerConfig` variants, `McpTransport`, `McpOAuthConfig`, config parsing |
| `rust/crates/tools/src/lib.rs` | (searched) | `global_mcp_registry()`, `run_mcp_tool()`, `run_list_mcp_resources()`, `run_read_mcp_resource()`, `run_mcp_auth()` |
| `rust/crates/rusty-claude-cli/src/main.rs` | (searched) | `RuntimeMcpState`, `CliToolExecutor`, `build_runtime_mcp_state()`, `mcp_runtime_tool_definition()`, `mcp_wrapper_tool_definitions()`, `permission_mode_for_mcp_tool()` |
| `rust/crates/runtime/src/lib.rs` | (searched) | Public re-exports of all MCP types |
