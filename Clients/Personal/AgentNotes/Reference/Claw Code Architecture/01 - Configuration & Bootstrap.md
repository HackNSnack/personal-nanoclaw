# 01 — Configuration & Bootstrap

## Summary (2-3 sentences)

The Configuration & Bootstrap system is responsible for discovering, validating, merging, and interpreting JSON config files across three scopes (User, Project, Local), then wiring the resulting `RuntimeConfig` into every subsystem the CLI needs: model selection, permission policies, MCP servers, plugin registries, tool registries, session management, and the conversation runtime. The bootstrap sequence starts in `main()`, dispatches through `run()` / `parse_args()` to one of many `CliAction` variants, and for interactive or prompt modes constructs a `LiveCli` which orchestrates the full lifecycle of config loading, system prompt assembly, API client creation, and REPL I/O. The bootstrap plan (`BootstrapPlan`) defines an ordered sequence of initialization phases, though the actual phase-gate logic is not yet wired into the runtime — the plan is currently a declarative manifest.

## Key Types & Structs (names, what they represent)

### Configuration (`runtime/src/config.rs`)

| Type | Description |
|------|-------------|
| `ConfigSource` | Enum: `User`, `Project`, `Local` — the scope/precedence tier of a config file. |
| `ConfigEntry` | A discovered config file path paired with its `ConfigSource`. |
| `ConfigLoader` | Discovers config files for a given `cwd` + `config_home`, reads/validates/merges them into a `RuntimeConfig`. Key methods: `discover()`, `load()`. |
| `RuntimeConfig` | The fully merged configuration. Contains: raw `merged` BTreeMap, `loaded_entries` list, and a parsed `RuntimeFeatureConfig`. Exposes typed accessors for every subsystem. |
| `RuntimeFeatureConfig` | Structured configuration consumed by subsystems. Contains: `hooks`, `plugins`, `mcp`, `oauth`, `model`, `aliases`, `permission_mode`, `permission_rules`, `sandbox`, `provider_fallbacks`, `trusted_roots`. |
| `RuntimeHookConfig` | Hook command lists: `pre_tool_use`, `post_tool_use`, `post_tool_use_failure`. Supports deduplicating merge via `merged()` / `extend()`. |
| `RuntimePluginConfig` | Plugin settings: `enabled_plugins` (name->bool), `external_directories`, `install_root`, `registry_path`, `bundled_root`, `max_output_tokens`. |
| `McpConfigCollection` | All configured MCP servers (`BTreeMap<String, ScopedMcpServerConfig>`). |
| `ScopedMcpServerConfig` | An MCP server config paired with the `ConfigSource` scope that defined it. |
| `McpServerConfig` | Enum of transport-specific MCP server configs: `Stdio`, `Sse`, `Http`, `Ws`, `Sdk`, `ManagedProxy`. |
| `McpTransport` | Enum of transport families: `Stdio`, `Sse`, `Http`, `Ws`, `Sdk`, `ManagedProxy`. |
| `McpStdioServerConfig` | Local stdio MCP server: command, args, env, optional tool_call_timeout_ms. |
| `McpRemoteServerConfig` | HTTP/SSE MCP server: url, headers, headers_helper, optional OAuth. |
| `McpWebSocketServerConfig` | WebSocket MCP server: url, headers, headers_helper. |
| `McpSdkServerConfig` | SDK-addressed MCP server: name. |
| `McpManagedProxyServerConfig` | Managed proxy MCP endpoint: url, id. |
| `McpOAuthConfig` | OAuth overrides for a remote MCP server. |
| `OAuthConfig` | Main runtime OAuth client config: client_id, authorize_url, token_url, callback_port, manual_redirect_url, scopes. |
| `ResolvedPermissionMode` | Enum: `ReadOnly`, `WorkspaceWrite`, `DangerFullAccess`. |
| `RuntimePermissionRuleConfig` | Permission rules grouped into `allow`, `deny`, `ask` string lists. |
| `ProviderFallbackConfig` | Ordered fallback chain: optional `primary` model + ordered `fallbacks` list. |
| `ConfigError` | Error enum: `Io(std::io::Error)`, `Parse(String)`. |

### Config Validation (`runtime/src/config_validate.rs`)

| Type | Description |
|------|-------------|
| `ConfigDiagnostic` | A single diagnostic with: path, field, optional line number, `DiagnosticKind`. |
| `DiagnosticKind` | Enum: `UnknownKey { suggestion }`, `WrongType { expected, got }`, `Deprecated { replacement }`. |
| `ValidationResult` | Container of error and warning `ConfigDiagnostic` vectors. `is_ok()` checks errors empty. |
| `FieldSpec` | Schema entry: field name + expected `FieldType`. |
| `FieldType` | Enum: `String`, `Bool`, `Object`, `StringArray`, `Number`. |
| `DeprecatedField` | Deprecated field: name + replacement guidance. |

Known top-level fields: `$schema`, `model`, `hooks`, `permissions`, `permissionMode`, `mcpServers`, `oauth`, `enabledPlugins`, `plugins`, `sandbox`, `env`, `aliases`, `providerFallbacks`, `trustedRoots`.

Deprecated fields: `permissionMode` (use `permissions.defaultMode`), `enabledPlugins` (use `plugins.enabled`).

Nested validation schemas exist for: hooks, permissions, plugins, sandbox, oauth.

### Bootstrap (`runtime/src/bootstrap.rs`)

| Type | Description |
|------|-------------|
| `BootstrapPhase` | Enum of 12 initialization phases: `CliEntry`, `FastPathVersion`, `StartupProfiler`, `SystemPromptFastPath`, `ChromeMcpFastPath`, `DaemonWorkerFastPath`, `BridgeFastPath`, `DaemonFastPath`, `BackgroundSessionFastPath`, `TemplateFastPath`, `EnvironmentRunnerFastPath`, `MainRuntime`. |
| `BootstrapPlan` | Ordered, deduplicated list of `BootstrapPhase` values. `claude_code_default()` returns the canonical 12-phase plan. |

### CLI Entry Point (`rusty-claude-cli/src/main.rs`)

| Type | Description |
|------|-------------|
| `CliAction` | Enum of all CLI dispatch targets: `DumpManifests`, `BootstrapPlan`, `Agents`, `Mcp`, `Skills`, `Plugins`, `PrintSystemPrompt`, `Version`, `ResumeSession`, `Status`, `Sandbox`, `Prompt`, `Doctor`, `Acp`, `State`, `Init`, `Config`, `Diff`, `Export`, `Repl`, `HelpTopic`, `Help`. |
| `CliOutputFormat` | Enum: `Text`, `Json`. |
| `ModelSource` | Enum tracking where the model string came from: `Flag`, `Env`, `Config`, `Default`. |
| `ModelProvenance` | Tracks `resolved` model string, optional `raw` input, and `source: ModelSource`. |
| `LiveCli` | The interactive runtime facade. Holds: `model`, `allowed_tools`, `permission_mode`, `system_prompt`, `runtime: BuiltRuntime`, `session: SessionHandle`, `prompt_history`. |
| `BuiltRuntime` | Wrapper around `ConversationRuntime<AnthropicRuntimeClient, CliToolExecutor>`, plus `PluginRegistry` and MCP state. Implements `Deref`/`DerefMut` to the inner `ConversationRuntime`. Drop impl shuts down MCP and plugins. |
| `RuntimePluginState` | Intermediate struct assembled during bootstrap: `feature_config`, `tool_registry: GlobalToolRegistry`, `plugin_registry: PluginRegistry`, `mcp_state`. |
| `RuntimeMcpState` | Holds: a Tokio runtime, `McpServerManager`, `pending_servers` (failed/unsupported), optional `McpDegradedReport`. |
| `SessionHandle` | Session id + file path. |
| `AnthropicRuntimeClient` | The API client adapter (despite the name, dispatches to Anthropic/xAI/OpenAI/DashScope via `detect_provider_kind`). |
| `CliToolExecutor` | Tool executor implementation for the CLI. |
| `CliPermissionPrompter` | Interactive stdin-based permission prompter. |

### Init (`rusty-claude-cli/src/init.rs`)

| Type | Description |
|------|-------------|
| `InitStatus` | Enum: `Created`, `Updated`, `Skipped`. |
| `InitArtifact` | Name + `InitStatus` for one init output. |
| `InitReport` | Project root + list of `InitArtifact`s. Render methods for text and JSON. |
| `RepoDetection` | Booleans for detected stack markers: `rust_workspace`, `rust_root`, `python`, `package_json`, `typescript`, `nextjs`, `react`, `vite`, `nest`, `src_dir`, `tests_dir`, `rust_dir`. |

## Flow (step-by-step logic)

### 1. CLI Entry (`main()` -> `run()`)

1. `main()` calls `run()`. If `run()` returns an error, `main()` classifies it via `classify_error_kind()` (returns machine-readable snake_case token), optionally splits it into short_reason + hint via `split_error_hint()`, emits JSON or text error, and exits with code 1.
2. `run()` collects `env::args()`, calls `parse_args(&args)` to produce a `CliAction`.

### 2. Argument Parsing (`parse_args()`)

3. `parse_args()` iterates through argv, extracting global flags:
   - `--model` / `--model=` -> resolved via `resolve_model_alias_with_config()` (checks user config aliases first, then built-in aliases `opus`/`sonnet`/`haiku`), validated via `validate_model_syntax()`.
   - `--output-format` -> `CliOutputFormat::Text` or `Json`.
   - `--permission-mode` / `--dangerously-skip-permissions` -> `PermissionMode`.
   - `--compact`, `--base-commit`, `--reasoning-effort`, `--allow-broad-cwd`, `--allowedTools`/`--allowed-tools`.
4. First positional arg determines subcommand (`version`, `status`, `init`, `config`, `diff`, `system-prompt`, `bootstrap-plan`, `agents`, `mcp`, `skills`, `plugins`, `doctor`, `acp`, `state`, `resume`, `sandbox`, `export`, `prompt`, `help`, etc.).
5. If no subcommand and stdin is a terminal: `CliAction::Repl`. If not a terminal or positional text provided: `CliAction::Prompt`.

### 3. Model Resolution

6. For REPL mode, `resolve_repl_model()` is called with the CLI model arg:
   - If model != DEFAULT_MODEL (user passed `--model`), use it directly.
   - Else check `ANTHROPIC_MODEL` env var, resolve through config aliases.
   - Else check config file model via `config_model_for_current_dir()` (loads config, reads `model` key).
   - Else fall back to `DEFAULT_MODEL` (`"claude-opus-4-6"`).

### 4. Permission Mode Resolution

7. If no `--permission-mode` flag:
   - Check `RUSTY_CLAUDE_PERMISSION_MODE` env var.
   - Check config via `config_permission_mode_for_current_dir()` (loads config, reads `permission_mode`).
   - Fall back to `PermissionMode::DangerFullAccess`.

### 5. Config Loading (happens inside `LiveCli::new()` -> `build_runtime()` -> `build_runtime_plugin_state()`)

8. `build_runtime_plugin_state()`:
   a. Creates `ConfigLoader::default_for(&cwd)` — config home defaults to `$CLAW_CONFIG_HOME` or `$HOME/.claw`.
   b. Calls `loader.load()` which:
      - `discover()` returns 5 candidate paths in precedence order:
        1. `{config_home_parent}/.claw.json` (User, legacy)
        2. `{config_home}/settings.json` (User)
        3. `{cwd}/.claw.json` (Project)
        4. `{cwd}/.claw/settings.json` (Project)
        5. `{cwd}/.claw/settings.local.json` (Local)
      - For each file: checks unsupported format (rejects `.toml`), attempts to read and parse JSON.
      - Validates via `validate_config_file()` — checks known top-level keys, nested object keys, types, deprecated fields, unknown keys with edit-distance suggestions.
      - Validates hooks individually per file (before merge).
      - Merges MCP servers per file (last scope wins per server name).
      - Deep-merges JSON objects (nested objects merge recursively, scalars overwrite).
      - Emits deprecation warnings to stderr.
      - Parses all feature-specific sub-configs into `RuntimeFeatureConfig`.

### 6. Plugin & Tool Registry Setup

9. `build_runtime_plugin_state_with_loader()`:
   a. `build_plugin_manager()` creates a `PluginManager` with paths resolved relative to cwd or config_home.
   b. `plugin_manager.plugin_registry()` discovers and loads plugins.
   c. Plugin hooks are extracted and merged with config hooks via `RuntimeHookConfig::merged()`.
   d. `build_runtime_mcp_state()` initializes MCP servers:
      - `RuntimeMcpState::new()` creates `McpServerManager::from_runtime_config()`, creates a Tokio runtime, runs `discover_tools_best_effort()` to probe all MCP servers.
      - Reports failed/unsupported servers as `pending_servers`.
      - Returns discovered tools as `RuntimeToolDefinition` entries, plus wrapper tools (`MCPTool`, `ListMcpResourcesTool`, `ReadMcpResourceTool`).
   e. `GlobalToolRegistry::with_plugin_tools()` + `.with_runtime_tools()` builds the final tool registry.

### 7. System Prompt Assembly

10. `build_system_prompt()` calls `load_system_prompt(cwd, date, os, "unknown")` from the `runtime::prompt` module.

### 8. Session Creation

11. `new_cli_session()` creates `Session::new().with_workspace_root(cwd)`.
12. `create_managed_session_handle()` uses `SessionStore::from_cwd()` then `create_handle()` to get a file-backed session path.

### 9. `ConversationRuntime` Construction

13. `build_runtime_with_plugin_state()`:
   a. Sets `session.model` if unset.
   b. Extracts `feature_config`, `tool_registry`, `plugin_registry`, `mcp_state` from `RuntimePluginState`.
   c. Calls `plugin_registry.initialize()`.
   d. Builds `PermissionPolicy` from mode + feature_config rules + tool registry specs.
   e. Creates `ConversationRuntime::new_with_features()` with:
      - The session
      - `AnthropicRuntimeClient::new()` (resolves provider via `detect_provider_kind`, creates `ApiProviderClient`)
      - `CliToolExecutor::new()` (tool execution)
      - Permission policy
      - System prompt
      - Feature config (for hooks, compaction, etc.)
   f. Optionally attaches hook progress reporter.
   g. Wraps in `BuiltRuntime`.

### 10. REPL Loop

14. `run_repl()`:
   a. `enforce_broad_cwd_policy()` — safety check for broad working directories.
   b. `run_stale_base_preflight()` — checks base commit staleness.
   c. Resolves model via `resolve_repl_model()`.
   d. Constructs `LiveCli::new()` (runs all of steps 5-9).
   e. Creates `LineEditor` for input.
   f. Prints startup banner (ASCII art + model, permissions, branch, workspace, directory, session info).
   g. Enters read-eval-print loop: reads input, dispatches slash commands, resolves skills, or runs conversation turns via `cli.run_turn()`.

### 11. One-shot Prompt Mode

15. `CliAction::Prompt` path:
   a. Optionally reads piped stdin (only in `DangerFullAccess` mode to avoid stealing stdin from permission prompter).
   b. Creates `LiveCli::new()` (same as REPL).
   c. Calls `cli.run_turn_with_output()` which dispatches to compact/json/text variants.

### 12. Init Subcommand

16. `run_init()` calls `initialize_repo(cwd)` which:
   a. Creates `.claw/` directory.
   b. Writes `.claw.json` with starter permissions (`dontAsk` default mode).
   c. Updates `.gitignore` with claw-specific entries.
   d. Generates `CLAUDE.md` via `render_init_claude_md()` which auto-detects repo stack (Rust, Python, TS/JS, Next.js, React, Vite, NestJS) and writes verification commands, repo shape, framework notes, and working agreement.

## Integration Points (how this connects to other categories)

### Config -> Conversation Runtime
- `RuntimeConfig.feature_config` is passed to `ConversationRuntime::new_with_features()` via the `&RuntimeFeatureConfig` parameter. The conversation runtime uses it for hook dispatch and compaction settings.

### Config -> MCP Server Management
- `RuntimeConfig.mcp()` returns `McpConfigCollection` which feeds `McpServerManager::from_runtime_config()`. MCP servers are initialized during bootstrap in `build_runtime_mcp_state()`, discovered tools are registered in the `GlobalToolRegistry`.

### Config -> Permission System
- `RuntimeFeatureConfig.permission_mode` -> converted to `PermissionMode` enum via `permission_mode_from_resolved()`.
- `RuntimeFeatureConfig.permission_rules` -> fed to `PermissionPolicy::with_permission_rules()`.
- Tool-specific permission requirements from the tool registry -> fed to `PermissionPolicy::with_tool_requirement()`.
- `CliPermissionPrompter` implements `runtime::PermissionPrompter` trait for interactive approval.

### Config -> Plugin System
- `RuntimeConfig.plugins()` -> `PluginManagerConfig` -> `PluginManager` -> `PluginRegistry`.
- Plugin hooks merge into `RuntimeHookConfig` via `RuntimeHookConfig::merged()`.
- Plugin tools merge into `GlobalToolRegistry` via `with_plugin_tools()`.

### Config -> Model / Provider
- `RuntimeConfig.model()` provides config-level model preference.
- `RuntimeConfig.aliases()` provides user-defined model alias resolution.
- `RuntimeConfig.provider_fallbacks()` provides fallback chain for retryable failures.
- Model resolution chain: CLI flag -> `ANTHROPIC_MODEL` env -> config model -> `DEFAULT_MODEL`.
- Alias resolution chain: config aliases -> built-in aliases (`opus`/`sonnet`/`haiku`).

### Config -> Sandbox
- `RuntimeConfig.sandbox()` returns `SandboxConfig` (enabled, namespace_restrictions, network_isolation, filesystem_mode, allowed_mounts).

### Config -> OAuth
- `RuntimeConfig.oauth()` returns `OAuthConfig` for the main runtime auth flow.
- Per-MCP-server OAuth config via `McpOAuthConfig`.

### Config -> Session Management
- `SessionStore::from_cwd()` creates the session store (uses `.claw/sessions/` under the working directory).
- Session path is passed to `BuiltRuntime` and persisted on each turn.

### Bootstrap Plan -> (Declarative only)
- `BootstrapPlan::claude_code_default()` defines 12 phases but there is no runtime code that gates execution on phase completion. It appears to be a manifest for future use (e.g., fast-path dispatch) or for the `claw bootstrap-plan` subcommand which just serializes it.

### Config -> Hooks
- `RuntimeHookConfig` (pre/post tool use, post failure) is consumed by `HookRunner` at tool execution time.

### Init -> Config
- `initialize_repo()` creates starter `.claw.json` and `CLAUDE.md`, establishing the project-level config baseline.

## Open Questions (anything unresolved for later phases)

1. **BootstrapPlan is declarative only**: The 12-phase `BootstrapPlan` is defined and exposed via `claw bootstrap-plan` subcommand, but no runtime code actually gates or sequences initialization based on these phases. Is this planned for future fast-path optimizations (e.g., short-circuiting to `FastPathVersion` for `claw --version`)?

2. **Config is loaded multiple times per invocation**: Several functions independently call `ConfigLoader::default_for(&cwd).load()` — e.g., `config_model_for_current_dir()`, `config_permission_mode_for_current_dir()`, `config_alias_for_current_dir()`, `current_tool_registry()`, `build_runtime_plugin_state()`. There's no caching layer, so a single CLI invocation may load and parse the same config files 3-5 times.

3. **Sandbox config parsing vs enforcement**: `SandboxConfig` is parsed from config and made available via `RuntimeConfig::sandbox()`, but the actual sandboxing enforcement logic needs investigation in the sandbox category.

4. **Provider fallback execution**: `ProviderFallbackConfig` is parsed and stored, but how the fallback chain is actually executed during API calls needs investigation in the API/provider category.

5. **Trust resolver is test-only**: `TrustResolver` and associated types are behind `#[cfg(test)]` — unclear if trust-based config restrictions are planned for production.

6. **`ConversationRuntime::new_with_features` signature**: The exact relationship between the feature config and the runtime's internal behavior (compaction thresholds, hook dispatch, etc.) needs tracing in the conversation runtime category.

7. **The `AnthropicRuntimeClient` naming**: The struct name is historically misaligned — it actually dispatches to any supported provider. The code has a TODO referencing ROADMAP #29 for cleanup.

8. **Session store location**: `SessionStore::from_cwd()` presumably computes `.claw/sessions/` under the working directory, but the exact path derivation is in `session_control.rs` which was not read here.

## Key Files Read (so later agents skip these)

| File | Absolute Path |
|------|---------------|
| config.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/config.rs` |
| config_validate.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/config_validate.rs` |
| bootstrap.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/bootstrap.rs` |
| lib.rs (runtime) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/lib.rs` |
| main.rs (CLI) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/rusty-claude-cli/src/main.rs` (partial — lines 1-700, 1423-1622, 3561-3986, 4133-4383, 5214-5248, 6089-6128, 6837-7050, 7251-7450, 8780-8840) |
| init.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/rusty-claude-cli/src/init.rs` (full) |

### Files NOT read but referenced (for later agents)

- `runtime/src/conversation.rs` — `ConversationRuntime`, `ApiClient` trait, `ToolExecutor` trait, turn loop
- `runtime/src/permissions.rs` — `PermissionPolicy`, `PermissionMode`, `PermissionPrompter` trait
- `runtime/src/session.rs` — `Session`, `ConversationMessage`, `ContentBlock`
- `runtime/src/session_control.rs` — `SessionStore`, session path derivation
- `runtime/src/prompt.rs` — `load_system_prompt()`, `SystemPromptBuilder`, `ProjectContext`
- `runtime/src/hooks.rs` — `HookRunner`, hook execution during tool calls
- `runtime/src/mcp_stdio.rs` — `McpServerManager`, MCP tool discovery
- `runtime/src/sandbox.rs` — `SandboxConfig`, sandbox enforcement
- `runtime/src/usage.rs` — `UsageTracker`, pricing model
- `tools/` crate — `GlobalToolRegistry`, `execute_tool`, tool definitions
- `plugins/` crate — `PluginManager`, `PluginRegistry`, plugin lifecycle
- `api/` crate — `ApiProviderClient`, `AnthropicClient`, provider detection
- `commands/` crate — slash command dispatch, skill resolution
