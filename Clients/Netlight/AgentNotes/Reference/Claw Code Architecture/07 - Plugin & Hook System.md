# 07 — Plugin & Hook System

> Claw Code architecture investigation — Plugin discovery, loading, lifecycle, hook dispatch, and plugin-contributed tools.

---

## Summary

The plugin system lives in `crates/plugins/` and provides a three-tier plugin model (Builtin, Bundled, External) with a manifest-driven hook system that fires shell commands around tool execution. Plugins can contribute tools to the `GlobalToolRegistry` (doc 05), register lifecycle commands (Init/Shutdown), and attach hook scripts to `PreToolUse`, `PostToolUse`, and `PostToolUseFailure` events. Two parallel `HookRunner` implementations exist — one in the `plugins` crate (simpler, used for plugin-level hook aggregation/testing) and one in the `runtime` crate (richer, with abort signals, progress reporting, permission overrides, and input mutation) — with the runtime version being the one that actually fires during the conversation loop.

---

## Key Types & Structs

| Type | Crate | Role |
|---|---|---|
| `PluginKind` | plugins | Enum: `Builtin`, `Bundled`, `External` |
| `PluginMetadata` | plugins | id, name, version, description, kind, source, default_enabled, root path |
| `PluginManifest` | plugins | Parsed plugin.json: permissions, hooks, lifecycle, tools, commands |
| `PluginHooks` | plugins | Three `Vec<String>` lists: `PreToolUse`, `PostToolUse`, `PostToolUseFailure` (command strings) |
| `PluginLifecycle` | plugins | `Init` and `Shutdown` command lists |
| `PluginPermission` | plugins | Enum: `Read`, `Write`, `Execute` — declared plugin-level permissions |
| `PluginToolPermission` | plugins | Enum: `ReadOnly`, `WorkspaceWrite`, `DangerFullAccess` — per-tool permission level |
| `PluginToolManifest` | plugins | Manifest entry: name, description, inputSchema, command, args, required_permission |
| `PluginTool` | plugins | Resolved tool: definition + command + args + permission + plugin root. Has `execute()` that spawns subprocess |
| `PluginToolDefinition` | plugins | Wire definition: name, description, input_schema (used by tool registry) |
| `PluginDefinition` | plugins | Enum wrapping `BuiltinPlugin`, `BundledPlugin`, `ExternalPlugin` |
| `Plugin` (trait) | plugins | `metadata()`, `hooks()`, `lifecycle()`, `tools()`, `validate()`, `initialize()`, `shutdown()` |
| `RegisteredPlugin` | plugins | `PluginDefinition` + `enabled: bool` |
| `PluginRegistry` | plugins | Sorted list of `RegisteredPlugin`. Methods: `aggregated_hooks()`, `aggregated_tools()`, `initialize()`, `shutdown()` |
| `PluginManager` | plugins | Discovery, install, update, uninstall, enable/disable, registry building |
| `PluginManagerConfig` | plugins | config_home, enabled_plugins map, external_dirs, install_root, registry_path, bundled_root |
| `InstalledPluginRegistry` | plugins | Persisted `BTreeMap<String, InstalledPluginRecord>` in `installed.json` |
| `PluginRegistryReport` | plugins | Registry + load failures (graceful degradation) |
| `HookEvent` (plugins) | plugins | Enum: `PreToolUse`, `PostToolUse`, `PostToolUseFailure` |
| `HookRunner` (plugins) | plugins | Simple runner: takes `PluginHooks`, runs shell commands, returns `HookRunResult` |
| `HookRunResult` (plugins) | plugins | `denied`, `failed`, `messages` |
| `HookEvent` (runtime) | runtime | Same enum, duplicated in runtime crate |
| `HookRunner` (runtime) | runtime | Richer runner: takes `RuntimeHookConfig`, supports abort signal, progress reporting, JSON output parsing |
| `HookRunResult` (runtime) | runtime | Extended: `denied`, `failed`, `cancelled`, `messages`, `permission_override`, `permission_reason`, `updated_input` |
| `HookAbortSignal` | runtime | `Arc<AtomicBool>` wrapper for cancelling long-running hooks |
| `HookProgressReporter` (trait) | runtime | Receives `Started`, `Completed`, `Cancelled` events per hook command |
| `HookProgressEvent` | runtime | Enum: `Started`, `Completed`, `Cancelled` with event type, tool name, command |
| `RuntimeHookConfig` | runtime | `pre_tool_use`, `post_tool_use`, `post_tool_use_failure` command lists (from merged config + plugin hooks) |
| `RuntimeFeatureConfig` | runtime | Holds `RuntimeHookConfig` + `RuntimePluginConfig` + MCP config |
| `PluginState` | runtime (plugin_lifecycle) | State machine: `Unconfigured` → `Validated` → `Starting` → `Healthy`/`Degraded`/`Failed` → `ShuttingDown` → `Stopped` |
| `PluginLifecycle` (trait, runtime) | runtime | `validate_config()`, `healthcheck()`, `discover()`, `shutdown()` — for MCP-style plugin servers |
| `PluginHealthcheck` | runtime | Plugin name + state + server health details |
| `DiscoveryResult` | runtime | Tools + resources + partial flag (from MCP-style plugins) |
| `DegradedMode` | runtime | Available/unavailable tools + reason when some servers fail |

---

## Plugin Discovery & Loading

### File System Layout

Plugins are discovered from three sources in order:

1. **Builtin plugins** — hardcoded in `builtin_plugins()`. Currently one: `example-builtin@builtin` (disabled by default, no hooks or tools).

2. **Installed plugins** (Bundled + External) — stored under `{config_home}/plugins/installed/`. Each plugin lives in its own subdirectory.

3. **External directory plugins** — additional directories listed in `PluginManagerConfig.external_dirs`. Scanned for plugin subdirectories.

### Manifest Format

Each plugin must have a `plugin.json` manifest at one of two locations within its root directory:
- `plugin.json` (direct, at root)
- `.claude-plugin/plugin.json` (packaged form)

The manifest schema (`RawPluginManifest` / `PluginManifest`):

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Plugin description",
  "permissions": ["read", "write", "execute"],
  "defaultEnabled": false,
  "hooks": {
    "PreToolUse": ["./hooks/pre.sh"],
    "PostToolUse": ["./hooks/post.sh"],
    "PostToolUseFailure": ["./hooks/failure.sh"]
  },
  "lifecycle": {
    "Init": ["./lifecycle/init.sh"],
    "Shutdown": ["./lifecycle/shutdown.sh"]
  },
  "tools": [
    {
      "name": "tool_name",
      "description": "Tool description",
      "inputSchema": { "type": "object", ... },
      "command": "./tools/handler.sh",
      "args": [],
      "requiredPermission": "workspace-write"
    }
  ],
  "commands": [
    {
      "name": "command_name",
      "description": "Command description",
      "command": "./commands/handler.sh"
    }
  ]
}
```

### Contract Compatibility Detection

Before parsing, `detect_claude_code_manifest_contract_gaps()` checks for Claude Code-specific fields that claw does not support:
- `skills` — claw discovers skills from local roots, not plugin manifests
- `mcpServers` — claw does not import MCP servers from plugins
- `agents` — claw does not load agent markdown catalogs from plugins
- `commands` with string-type entries (Claude Code glob style)
- Hook names other than `PreToolUse`, `PostToolUse`, `PostToolUseFailure`

These produce `UnsupportedManifestContract` validation errors.

### Manifest Validation

`build_plugin_manifest()` performs thorough validation:
- Required fields: name, version, description (non-empty)
- Permissions: valid values only (`read`, `write`, `execute`), no duplicates
- Hooks, lifecycle, tools, commands: all referenced paths validated (must exist as files, not directories)
- Tool input schemas: must be JSON objects
- Tool permissions: must be `read-only`, `workspace-write`, or `danger-full-access`

### Path Resolution

Relative paths in hooks/tools/lifecycle (starting with `./` or `../`) are resolved against the plugin root directory. Non-relative paths are treated as shell commands to run via `sh -lc`.

### Plugin ID Format

Plugin IDs follow the pattern `{name}@{marketplace}` where marketplace is `builtin`, `bundled`, or `external`. Examples: `example-builtin@builtin`, `sample-hooks@bundled`, `my-plugin@external`.

### Bundled Plugin Syncing

On every `plugin_registry()` call, `sync_bundled_plugins()`:
1. Scans the bundled source root (`crates/plugins/bundled/`)
2. Copies each bundled plugin to the install root if missing, outdated, or corrupt
3. Records them in `installed.json` with `kind: Bundled`
4. Removes stale bundled plugins that no longer exist in the source tree

---

## Plugin Kinds

### Builtin (`PluginKind::Builtin`)

- Defined in Rust code via `builtin_plugins()` function
- No file system root (`root: None`)
- `validate()` always succeeds (no paths to check)
- `initialize()` and `shutdown()` are no-ops
- Cannot be uninstalled
- Enabled state defaults to `default_enabled` from metadata
- Currently only the `example-builtin` scaffold exists (disabled by default, no hooks/tools)
- Marketplace tag: `builtin`

### Bundled (`PluginKind::Bundled`)

- Ship with the binary in `crates/plugins/bundled/` directories
- Automatically synced to the install root on startup
- Have a file system root and run full validation (hook paths, lifecycle paths, tool paths)
- `initialize()` runs lifecycle Init commands as subprocesses
- `shutdown()` runs lifecycle Shutdown commands
- Cannot be uninstalled (attempting to uninstall returns an error: "managed automatically; disable it instead")
- Enabled state defaults to `default_enabled` from manifest
- Marketplace tag: `bundled`
- Current bundled plugins: `example-bundled` and `sample-hooks` (both disabled by default, hooks only)

### External (`PluginKind::External`)

- Installed from local paths or git URLs via `PluginManager::install()`
- Full validation, initialization, and shutdown like Bundled
- Can be installed, updated, uninstalled
- On install, the source is either copied (local path) or `git clone --depth 1` (git URL)
- Enabled state defaults to `false` (explicitly disabled unless toggled on)
- Marketplace tag: `external`
- Can also be discovered from external directory paths in config

### Key Behavioral Differences

| Capability | Builtin | Bundled | External |
|---|---|---|---|
| File system root | None | Yes (installed copy) | Yes (installed copy) |
| Path validation | Skipped | Full | Full |
| Lifecycle commands | No-op | Executed | Executed |
| Install source | Hardcoded | Auto-synced from bundled/ | Local path or git URL |
| Uninstall | N/A | Blocked | Allowed |
| Default enabled | From metadata | From manifest | Always false |

---

## Hook System

### Two HookRunner Implementations

There are two parallel `HookRunner` types:

1. **`plugins::HookRunner`** — lightweight, takes `PluginHooks` directly. Used for plugin-level testing. Spawns shell commands, interprets exit codes (0=allow, 2=deny, other=failed). Returns simple `HookRunResult` with `denied`, `failed`, `messages`.

2. **`runtime::HookRunner`** — full-featured, takes `RuntimeHookConfig`. Used in the actual conversation loop. Adds:
   - **Abort signal** (`HookAbortSignal`): an `Arc<AtomicBool>` that can cancel long-running hooks by killing the child process
   - **Progress reporting** (`HookProgressReporter` trait): emits `Started`/`Completed`/`Cancelled` events
   - **Structured JSON output parsing**: hooks can return JSON with rich control fields
   - **Permission override**: hooks can set `permissionDecision` to `allow`/`deny`/`ask`
   - **Input mutation**: hooks can return `updatedInput` to modify tool input before execution
   - **Cancellation state**: `cancelled` flag in result

### Hook Events

Three events, fired around every tool execution in the conversation loop:

1. **`PreToolUse`** — fired before tool execution
   - Can **deny** execution (exit code 2, or JSON `"continue": false` / `"decision": "block"`)
   - Can **modify input** via `hookSpecificOutput.updatedInput`
   - Can **override permissions** via `hookSpecificOutput.permissionDecision`
   - Can inject **system messages** via `systemMessage` / `reason` / `additionalContext`
   - On deny: tool is not executed, error result sent back to model

2. **`PostToolUse`** — fired after successful tool execution
   - Receives tool output in `HOOK_TOOL_OUTPUT` env var and JSON payload
   - Can report messages that get appended to tool output
   - If denied/failed/cancelled: output is marked as error

3. **`PostToolUseFailure`** — fired after tool execution fails
   - Receives the error in `HOOK_TOOL_OUTPUT`/`tool_error` field
   - Same deny/fail semantics as PostToolUse

### Hook Execution Protocol

Each hook command receives context via:

**Environment variables:**
- `HOOK_EVENT` — event name (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`)
- `HOOK_TOOL_NAME` — tool being invoked
- `HOOK_TOOL_INPUT` — JSON string of tool input
- `HOOK_TOOL_IS_ERROR` — `"1"` or `"0"`
- `HOOK_TOOL_OUTPUT` — tool output (only for post-hooks)

**Stdin (JSON payload):**
```json
{
  "hook_event_name": "PreToolUse",
  "tool_name": "bash",
  "tool_input": { "command": "pwd" },
  "tool_input_json": "{\"command\":\"pwd\"}",
  "tool_output": null,
  "tool_result_is_error": false
}
```

**Exit code semantics:**
- `0` — allow (proceed normally)
- `2` — deny (block the tool use)
- Any other code — failure (hook error, stops remaining hooks)

**Structured JSON stdout (runtime HookRunner only):**
```json
{
  "systemMessage": "Message injected into tool result",
  "reason": "Additional reason text",
  "continue": false,
  "decision": "block",
  "hookSpecificOutput": {
    "additionalContext": "Extra context message",
    "permissionDecision": "allow",
    "permissionDecisionReason": "Approved by policy hook",
    "updatedInput": { "command": "git status" }
  }
}
```

If stdout is not valid JSON, it is treated as a plain text message. If stdout looks like a JSON attempt but fails to parse, a diagnostic `hook_invalid_json:` message is generated.

### Hook Ordering and Short-Circuiting

- Multiple hook commands for the same event run sequentially in order
- On **deny**: remaining hooks are skipped, denied result returned immediately
- On **failure** (non-0/non-2 exit): remaining hooks are skipped, failed result returned
- On **cancel** (abort signal): child process is killed, remaining hooks skipped
- Messages from all executed hooks are accumulated in order

### Hook Merging

Plugin hooks and config-level hooks are merged:
1. `PluginRegistry.aggregated_hooks()` — iterates enabled plugins, merges all `PluginHooks` (concatenates command lists)
2. `runtime_hook_config_from_plugin_hooks()` converts `PluginHooks` → `RuntimeHookConfig`
3. Config-level hooks (`runtime_config.hooks()`) are merged with plugin hooks: `runtime_config.hooks().merged(&plugin_hook_config)`
4. The merged `RuntimeHookConfig` is stored in `RuntimeFeatureConfig` and used to construct the `HookRunner`

### Hook Integration in the Conversation Loop

In `ConversationRuntime::run_turn_loop()`:

```
for each pending tool use:
    1. pre_hook = run_pre_tool_use_hook(tool_name, input)
    2. effective_input = pre_hook.updated_input OR original input
    3. Build PermissionContext with hook's permission_override
    4. Check permission (may be overridden by hook)
    5. If allowed:
       a. Execute tool with effective_input
       b. Merge pre_hook messages into output
       c. Run post_tool_use_hook or post_tool_use_failure_hook
       d. Merge post_hook messages into output
       e. If post-hook denied/failed/cancelled: mark as error
    6. If denied by permission:
       a. Merge pre_hook messages into denial reason
```

---

## Plugin Tools

### How Plugin Tools Are Defined

In `plugin.json`, tools declare:
- `name` — tool name (must not conflict with builtin tools)
- `description` — tool description
- `inputSchema` — JSON Schema object for tool input
- `command` — executable path (relative to plugin root or shell command)
- `args` — additional command-line arguments
- `requiredPermission` — `read-only`, `workspace-write`, or `danger-full-access`

### Tool Execution

`PluginTool::execute()` spawns a subprocess:
1. Runs `command` with `args`
2. Passes tool input JSON via **both** stdin and env var `CLAWD_TOOL_INPUT`
3. Sets environment: `CLAWD_PLUGIN_ID`, `CLAWD_PLUGIN_NAME`, `CLAWD_TOOL_NAME`, `CLAWD_TOOL_INPUT`, `CLAWD_PLUGIN_ROOT`
4. If the plugin has a root, sets `current_dir` to it
5. Reads stdout as the result, stderr as error detail on failure
6. Returns `Ok(stdout)` on exit 0, `Err(CommandFailed)` otherwise

### How Plugin Tools Get Into the Registry

The flow from plugin manifest to API-visible tool:

```
PluginManager::plugin_registry()
  → PluginRegistry with all RegisteredPlugins
    → plugin_registry.aggregated_tools()
      → Vec<PluginTool> (from all enabled plugins, dedup-checked)
        → GlobalToolRegistry::with_plugin_tools(plugin_tools)
          → Name-conflict check against builtins
          → GlobalToolRegistry stores Vec<PluginTool>
            → definitions() includes plugin tools in Vec<ToolDefinition> for API
            → execute() dispatches to PluginTool::execute() for plugin tool names
```

Key constraint: plugin tool names **must not** shadow builtin tool names. The `with_plugin_tools()` constructor checks and returns an error if a conflict is detected.

---

## Integration Points

### With Tool Execution (doc 05)

- **`GlobalToolRegistry`** (doc 05) holds `plugin_tools: Vec<PluginTool>` alongside builtin specs and runtime tools
- **`PluginTool`** has its own `execute()` method that spawns a subprocess — it bypasses the central `match` dispatcher
- **`PluginToolPermission`** maps to the same permission model as builtin tools (`ReadOnly`→`WorkspaceRead`, `WorkspaceWrite`, `DangerFullAccess`→`DangerousOperation`)
- Plugin tools appear in `definitions()` output alongside builtins and MCP tools, making them visible to the model

### With Conversation Loop (doc 04)

- **`ConversationRuntime`** holds a `HookRunner` (runtime version) constructed from `RuntimeFeatureConfig`
- Hooks fire synchronously within the tool dispatch loop — the conversation is blocked while hooks run
- **`HookAbortSignal`** is stored on the runtime and can cancel hooks mid-execution
- **`HookProgressReporter`** is optional, used for UI feedback

### With Permission System

- Pre-tool-use hooks can return `permissionDecision: "allow"/"deny"/"ask"` to override the normal permission prompt
- This creates a `PermissionOverride` that is passed to `PermissionContext` in the conversation loop
- This allows hooks to implement custom permission policies (e.g., auto-allow certain bash commands)

### With Runtime Plugin Lifecycle (plugin_lifecycle.rs)

The `runtime::plugin_lifecycle` module defines a separate, MCP-oriented lifecycle model:
- **`PluginState`** state machine: `Unconfigured` → `Validated` → `Starting` → `Healthy`/`Degraded`/`Failed` → `ShuttingDown` → `Stopped`
- **`PluginLifecycle` trait** (runtime version): `validate_config()`, `healthcheck()`, `discover()`, `shutdown()`
- **`ServerHealth`**: tracks individual server status (`Healthy`/`Degraded`/`Failed`)
- **`DegradedMode`**: when some servers fail, tracks available vs unavailable tools
- This is a more sophisticated lifecycle than the plugins crate's simple Init/Shutdown commands — designed for MCP-style plugins that manage external server processes

---

## Open Questions

1. **Two HookRunner implementations**: The `plugins` crate and `runtime` crate each define their own `HookRunner` with different capabilities. The `plugins` version is simpler (no abort, no JSON parsing, no permission override). Is the intent to eventually consolidate, or do they serve permanently different purposes?

2. **Plugin tool permission enforcement**: `PluginTool` has `required_permission: PluginToolPermission`, but the execute path in `PluginTool::execute()` does not check permissions itself. Doc 05 noted that plugin tools bypass the central `match` dispatcher. How/where is `PluginToolPermission` mapped to the `PermissionEnforcer`?

3. **Runtime plugin_lifecycle vs plugins crate lifecycle**: Two different lifecycle models exist — the plugins crate has simple `Init`/`Shutdown` shell commands, while the runtime crate has a full state machine with healthchecks, server monitoring, and degraded mode. Are these for different plugin categories, or is there a planned migration?

4. **Hook output to model**: Hook messages are merged into tool results via `merge_hook_feedback()`. This means the model sees hook-injected text as part of tool output. Is there a mechanism to distinguish hook feedback from actual tool output in the model's context?

5. **Concurrent hook execution**: Hooks run sequentially within each event. For plugins with many hooks, this could add latency. Is there a plan for parallel hook execution?

6. **Plugin command execution**: `PluginCommandManifest` is parsed and validated but the dispatch path for plugin commands (as opposed to plugin tools) was not observed in the conversation loop or tool registry. Are plugin commands a future feature?

7. **Builtin plugin extensibility**: Currently `builtin_plugins()` returns a single scaffold with no hooks or tools. Is the intent for Rust-native plugins to eventually register here with compiled-in behavior?

8. **Plugin settings persistence**: Enabled/disabled state is written to `settings.json` under `enabledPlugins`. This is separate from `installed.json` (the install registry). Is there a reason for the split rather than a single plugin state file?

---

## Key Files Read

| File | Lines | Purpose |
|---|---|---|
| `rust/crates/plugins/src/lib.rs` | ~2500 | PluginManager, PluginRegistry, manifest loading, install/update/uninstall, bundled sync, plugin types |
| `rust/crates/plugins/src/hooks.rs` | ~565 | HookRunner (plugins version), HookEvent, HookRunResult, shell command execution, exit code protocol |
| `rust/crates/plugins/src/test_isolation.rs` | ~74 | EnvLock for test isolation — redirects HOME/XDG to temp dirs |
| `rust/crates/runtime/src/hooks.rs` | ~1117 | HookRunner (runtime version), JSON output parsing, permission override, input mutation, abort signal, progress reporting |
| `rust/crates/runtime/src/plugin_lifecycle.rs` | ~534 | PluginState state machine, PluginLifecycle trait, ServerHealth, DegradedMode, healthcheck system |
| `rust/crates/runtime/src/config.rs` | (searched) | RuntimeHookConfig, RuntimePluginConfig, RuntimeFeatureConfig definitions |
| `rust/crates/runtime/src/conversation.rs` | (searched) | Hook integration in ConversationRuntime::run_turn_loop(), merge_hook_feedback |
| `rust/crates/rusty-claude-cli/src/main.rs` | (searched) | build_runtime_plugin_state, runtime_hook_config_from_plugin_hooks, hook merging |
| `rust/crates/plugins/bundled/example-bundled/.claude-plugin/plugin.json` | 10 | Example bundled manifest: PreToolUse + PostToolUse hooks |
| `rust/crates/plugins/bundled/sample-hooks/.claude-plugin/plugin.json` | 10 | Sample hooks bundled manifest: PreToolUse + PostToolUse hooks |
| `rust/crates/plugins/bundled/example-bundled/hooks/pre.sh` | 2 | Simple pre-hook: prints message |
| `rust/crates/plugins/bundled/example-bundled/hooks/post.sh` | 2 | Simple post-hook: prints message |
| `rust/crates/plugins/bundled/sample-hooks/hooks/pre.sh` | 2 | Simple pre-hook: prints message |
| `rust/crates/plugins/bundled/sample-hooks/hooks/post.sh` | 2 | Simple post-hook: prints message |
