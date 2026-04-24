# 04 — Conversation Loop & Sessions

## Summary (2-3 sentences)

The conversation loop is the central spine of claw-code: `ConversationRuntime<C, T>` (generic over `ApiClient` and `ToolExecutor`) owns the `Session`, drives a synchronous inner loop that calls the model, extracts tool-use blocks, runs hooks + permission checks + tool execution, and feeds results back until the model emits a response with no tool calls. Sessions are persisted incrementally as append-only JSONL files under a workspace-fingerprinted directory (`<cwd>/.claw/sessions/<hash>/`), with `SessionStore` providing namespace isolation, reference resolution, listing, forking, and legacy-format compatibility. Auto-compaction triggers when cumulative input tokens exceed a configurable threshold (default 100K), summarizing older messages into a synthetic System-role preamble while preserving a tail of recent messages and avoiding orphaned tool-use/tool-result pair splits.

## Key Types & Structs

### Conversation Loop (`runtime/src/conversation.rs`)

| Type | Description |
|------|-------------|
| `ConversationRuntime<C, T>` | The core orchestrator. Generic over `C: ApiClient` and `T: ToolExecutor`. Holds: `session: Session`, `api_client: C`, `tool_executor: T`, `permission_policy: PermissionPolicy`, `system_prompt: Vec<String>`, `max_iterations: usize` (default `usize::MAX`), `usage_tracker: UsageTracker`, `hook_runner: HookRunner`, `auto_compaction_input_tokens_threshold: u32`, `hook_abort_signal`, optional `hook_progress_reporter`, optional `session_tracer: SessionTracer`. |
| `ApiClient` (trait) | Single method: `stream(&mut self, request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError>`. Despite the name "stream", the trait returns a collected `Vec<AssistantEvent>` rather than a live stream — the actual SSE streaming happens inside the CLI's `AnthropicRuntimeClient` implementation, which collects events before returning. |
| `ToolExecutor` (trait) | Single method: `execute(&mut self, tool_name: &str, input: &str) -> Result<String, ToolError>`. The CLI implements this via `CliToolExecutor`. |
| `ApiRequest` | Wire-level payload: `system_prompt: Vec<String>`, `messages: Vec<ConversationMessage>`. Constructed each iteration from the runtime's prompt + session messages. |
| `AssistantEvent` (enum) | Events emitted from one API call: `TextDelta(String)`, `ToolUse { id, name, input }`, `Usage(TokenUsage)`, `PromptCache(PromptCacheEvent)`, `MessageStop`. |
| `PromptCacheEvent` | Cache-break telemetry: `unexpected: bool`, `reason`, `previous_cache_read_input_tokens`, `current_cache_read_input_tokens`, `token_drop`. |
| `TurnSummary` | Result of one `run_turn()` call: `assistant_messages: Vec<ConversationMessage>`, `tool_results: Vec<ConversationMessage>`, `prompt_cache_events: Vec<PromptCacheEvent>`, `iterations: usize`, `usage: TokenUsage`, `auto_compaction: Option<AutoCompactionEvent>`. |
| `AutoCompactionEvent` | `removed_message_count: usize` — emitted when auto-compaction fires at the end of a turn. |
| `RuntimeError` | Simple `message: String` error for turn failures. |
| `ToolError` | Simple `message: String` error for tool execution failures. |
| `StaticToolExecutor` | Test-only in-memory tool executor backed by a `BTreeMap<String, ToolHandler>`. |

### Session (`runtime/src/session.rs`)

| Type | Description |
|------|-------------|
| `Session` | Core persisted state. Fields: `version: u32` (always 1), `session_id: String` (format: `session-{millis}-{counter}`), `created_at_ms: u64`, `updated_at_ms: u64`, `messages: Vec<ConversationMessage>`, `compaction: Option<SessionCompaction>`, `fork: Option<SessionFork>`, `workspace_root: Option<PathBuf>`, `prompt_history: Vec<SessionPromptEntry>`, `last_health_check_ms: Option<u64>`, `model: Option<String>`, `persistence: Option<SessionPersistence>` (private, holds file path). |
| `MessageRole` (enum) | `System`, `User`, `Assistant`, `Tool`. |
| `ContentBlock` (enum) | `Text { text }`, `ToolUse { id, name, input }`, `ToolResult { tool_use_id, tool_name, output, is_error }`. |
| `ConversationMessage` | `role: MessageRole`, `blocks: Vec<ContentBlock>`, `usage: Option<TokenUsage>`. Factory methods: `user_text()`, `assistant()`, `assistant_with_usage()`, `tool_result()`. |
| `SessionCompaction` | `count: u32` (how many times compacted), `removed_message_count: usize`, `summary: String`. |
| `SessionFork` | `parent_session_id: String`, `branch_name: Option<String>`. |
| `SessionPromptEntry` | `timestamp_ms: u64`, `text: String` — user prompt history. |
| `SessionError` (enum) | `Io(std::io::Error)`, `Json(JsonError)`, `Format(String)`. |

### Session Control (`runtime/src/session_control.rs`)

| Type | Description |
|------|-------------|
| `SessionStore` | Per-worktree session store. Fields: `sessions_root: PathBuf`, `workspace_root: PathBuf`. Constructors: `from_cwd()` (derives `<cwd>/.claw/sessions/<workspace_hash>/`), `from_data_dir()` (explicit data dir). Methods: `create_handle()`, `resolve_reference()`, `list_sessions()`, `latest_session()`, `load_session()`, `fork_session()`. |
| `SessionHandle` | `id: String`, `path: PathBuf`. |
| `ManagedSessionSummary` | Lightweight metadata for listing: `id`, `path`, `updated_at_ms`, `modified_epoch_millis`, `message_count`, `parent_session_id`, `branch_name`. Sorted by `updated_at_ms` descending (semantic time preferred over file mtime). |
| `LoadedManagedSession` | `handle: SessionHandle`, `session: Session`. |
| `ForkedManagedSession` | `parent_session_id`, `handle`, `session`, `branch_name`. |
| `SessionControlError` (enum) | `Io`, `Session`, `Format`, `WorkspaceMismatch { expected, actual }`. |
| `workspace_fingerprint()` | FNV-1a (64-bit) hash of the canonical workspace path, producing a 16-char hex string for directory partitioning. |

### Compaction (`runtime/src/compact.rs`)

| Type | Description |
|------|-------------|
| `CompactionConfig` | `preserve_recent_messages: usize` (default 4), `max_estimated_tokens: usize` (default 10,000). |
| `CompactionResult` | `summary: String`, `formatted_summary: String`, `compacted_session: Session`, `removed_message_count: usize`. |

### Summary Compression (`runtime/src/summary_compression.rs`)

| Type | Description |
|------|-------------|
| `SummaryCompressionBudget` | `max_chars: usize` (default 1,200), `max_lines: usize` (default 24), `max_line_chars: usize` (default 160). |
| `SummaryCompressionResult` | `summary`, `original_chars`, `compressed_chars`, `original_lines`, `compressed_lines`, `removed_duplicate_lines`, `omitted_lines`, `truncated`. |

## Conversation Loop Flow (step-by-step: what happens each turn?)

### CLI Layer (REPL)

1. **User types input** in the REPL (`run_repl()` in main.rs). Input is read via `LineEditor`.
2. **Slash command check**: If input starts with `/`, it's dispatched to `handle_slash_command()` instead of the turn loop.
3. **Skill resolution**: If input matches a bare skill name, it's resolved into a prompt.
4. **Prompt history recording**: `cli.record_prompt_history(&trimmed)` stores the prompt in `LiveCli`'s prompt history (and in the session's JSONL file).
5. **`LiveCli::run_turn(input)`** is called:
   a. `prepare_turn_runtime(true)` clones the current session, creates a fresh `BuiltRuntime` (new `ConversationRuntime`) with the same system prompt, model, and permission mode, and spawns a `HookAbortMonitor`.
   b. A spinner is displayed ("Thinking...").
   c. A `CliPermissionPrompter` is created.
   d. `runtime.run_turn(input, Some(&mut permission_prompter))` is called — this is the core loop.
   e. On success: `replace_runtime(runtime)` swaps the new runtime (with updated session) into `LiveCli`, then `persist_session()` saves the session to disk.
   f. On error: the old runtime is preserved; the error is displayed.

### Core Loop (`ConversationRuntime::run_turn()`)

1. **Health probe** (if session has `compaction`): Runs `run_session_health_probe()` which calls `tool_executor.execute("glob_search", ...)` with a no-match pattern. If the probe fails, the turn is aborted with a descriptive error suggesting `/session new`.

2. **Record turn start**: Emits a `turn_started` session trace event.

3. **Push user message**: `session.push_user_text(user_input)` adds the user message to the session's message list and (if persistence is configured) appends it to the JSONL file.

4. **Enter the iteration loop**:
   - Increment iteration counter. Check against `max_iterations` (default `usize::MAX`).
   - **Build API request**: `ApiRequest { system_prompt: self.system_prompt.clone(), messages: self.session.messages.clone() }`.
   - **Call API**: `self.api_client.stream(request)` — returns `Vec<AssistantEvent>`.
   - **Build assistant message**: `build_assistant_message(events)` processes events into a `ConversationMessage` with `ContentBlock`s. Text deltas are concatenated; tool uses become `ContentBlock::ToolUse`. Validates that `MessageStop` was received and at least one content block was produced.
   - **Record usage**: If `AssistantEvent::Usage` was present, update the `UsageTracker`.
   - **Collect prompt cache events** from the event stream.
   - **Extract pending tool uses**: Filter assistant message blocks for `ContentBlock::ToolUse` entries.
   - **Emit trace event** for the assistant iteration.
   - **Push assistant message** to the session (and JSONL persistence).

5. **Check for loop termination**: If `pending_tool_uses` is empty, **break** — the model has finished and the turn is complete.

6. **Execute each pending tool** (sequentially, not in parallel):
   a. **Pre-tool hook**: `run_pre_tool_use_hook(tool_name, input)` — may cancel, deny, fail, or modify the input.
   b. **Determine effective input**: Use the hook's `updated_input()` if provided, otherwise use the original.
   c. **Build permission context** from hook results.
   d. **Permission check**:
      - If hook cancelled/failed/denied: `PermissionOutcome::Deny` with hook message.
      - Otherwise: `permission_policy.authorize_with_context(tool_name, effective_input, context, prompter)`.
   e. **On `PermissionOutcome::Allow`**:
      - Execute the tool: `tool_executor.execute(tool_name, effective_input)`.
      - Merge pre-hook feedback into tool output.
      - Run post-tool hook (success or failure variant depending on whether tool errored).
      - If post-hook denies/fails/cancels, mark as error.
      - Merge post-hook feedback into output.
      - Build `ConversationMessage::tool_result(...)`.
   f. **On `PermissionOutcome::Deny`**:
      - Build `ConversationMessage::tool_result(...)` with `is_error: true` and the denial reason.
   g. **Push tool result** to session and JSONL persistence.
   h. **Emit trace events** for tool start/finish.

7. **After loop exits**: Run `maybe_auto_compact()` (see Compaction section below).

8. **Build `TurnSummary`** and emit `turn_completed` trace event.

### Key Decision: When to stop vs continue

The loop continues as long as the assistant's response contains `ContentBlock::ToolUse` blocks. The loop terminates when:
- The assistant emits only text (no tool uses) — **normal termination**.
- `max_iterations` is exceeded — **error**.
- The API call fails — **error**.
- The assistant stream is malformed (no `MessageStop`, empty content) — **error**.
- The session health probe fails after compaction — **error** (before the loop even starts).

**Denied tools do NOT stop the loop.** When a tool is denied (by permission policy, hook, or user), the denial is sent back as an error tool result, and the loop continues — the model sees the denial and may try again or respond with text.

## Message Lifecycle (how messages are created, sent, received, stored)

### Creation

1. **User messages**: `ConversationMessage::user_text(input)` — role=User, single `ContentBlock::Text`.
2. **Assistant messages**: Built by `build_assistant_message()` from `Vec<AssistantEvent>`. Text deltas are flushed into `ContentBlock::Text` blocks; `AssistantEvent::ToolUse` becomes `ContentBlock::ToolUse`. Usage is attached via `assistant_with_usage()`.
3. **Tool results**: `ConversationMessage::tool_result(tool_use_id, tool_name, output, is_error)` — role=Tool, single `ContentBlock::ToolResult`.
4. **System messages** (compaction): Created during compaction with role=System, containing the continuation summary.

### Storage in Session

Messages are stored in `session.messages: Vec<ConversationMessage>`. Each `push_message()`:
- Updates `updated_at_ms` via `touch()`.
- Appends the message to the in-memory `Vec`.
- If a persistence path is configured, appends a JSONL record to the file. If the file doesn't exist or is empty, writes a full snapshot first (header + all messages).
- If persistence fails, the message is popped from the `Vec` and the error propagates.

### Sent to API

On each loop iteration, `ApiRequest` is constructed with `system_prompt.clone()` and `session.messages.clone()`. The entire message history is sent every time — there is no incremental/delta approach. The `AnthropicRuntimeClient::stream()` in main.rs joins the system prompt sections with `"\n\n"`, converts `ConversationMessage` to API-level `InputMessage`, and builds a `MessageRequest` (from doc 02).

### Received from API

`AssistantEvent`s are collected into a `Vec` by the `ApiClient::stream()` implementation. The conversation loop calls `build_assistant_message()` which:
- Concatenates `TextDelta` strings into `ContentBlock::Text` blocks.
- Maps `ToolUse { id, name, input }` to `ContentBlock::ToolUse`.
- Captures `Usage` and `PromptCache` events as side-channel data.
- Requires `MessageStop` to be present; otherwise returns `RuntimeError`.

## Session Persistence (how sessions are saved, loaded, resumed)

### File Format: JSONL (primary)

Sessions are stored as append-only JSONL files. Each line is a typed JSON record:

| Record Type | Fields | Purpose |
|-------------|--------|---------|
| `session_meta` | `version`, `session_id`, `created_at_ms`, `updated_at_ms`, `fork`, `workspace_root`, `model` | Header — written once at snapshot |
| `compaction` | `count`, `removed_message_count`, `summary` | Compaction metadata |
| `prompt_history` | `timestamp_ms`, `text` | User prompt history entries |
| `message` | `message: { role, blocks, usage }` | Individual conversation messages |

A full snapshot writes: `session_meta`, optional `compaction`, all `prompt_history` entries, then all `message` records. Incremental appends add individual `message` or `prompt_history` records.

### Legacy Format: JSON Object

The `load_from_path()` method auto-detects format: if the file parses as a JSON object with a `messages` key, it's loaded as legacy format via `from_json()`. Otherwise it's parsed as JSONL.

### File Rotation

When `save_to_path()` is called and the existing file exceeds `ROTATE_AFTER_BYTES` (256 KB), the current file is renamed to `{stem}.rot-{timestamp}.jsonl` and a fresh snapshot is written. Old rotated files are cleaned up, keeping at most `MAX_ROTATED_FILES` (3).

### Atomic Writes

`write_atomic()` writes to a temporary file (`{name}.tmp-{timestamp}-{counter}`) then renames to the target path. Parent directories are created as needed.

### Session Store Directory Layout

```
<cwd>/.claw/sessions/<workspace_hash>/
  session-1234567890-0.jsonl
  session-1234567891-1.jsonl
  ...
```

The `workspace_hash` is a 16-char hex string from FNV-1a hashing the canonical (symlink-resolved) workspace root path. This ensures:
- Different workspaces produce different session directories.
- Symlink-equivalent paths (e.g., `/tmp` vs `/private/tmp` on macOS) resolve to the same namespace.

### Session ID Generation

`generate_session_id()` produces `session-{millis}-{counter}` where:
- `millis` is from `current_time_millis()` — a monotonic wall-clock function that uses `AtomicU64` CAS to guarantee strictly increasing values even under tight loops.
- `counter` is from a global `AtomicU64` counter.

### Session Loading and Resumption

- `SessionStore::load_session(reference)` resolves a reference (session ID, "latest"/"last"/"recent" alias, or file path), loads the JSONL file, and validates the workspace root.
- Workspace mismatch: If the loaded session's `workspace_root` doesn't match the store's workspace, a `WorkspaceMismatch` error is returned. Legacy sessions without a `workspace_root` are allowed if the session file is physically inside the workspace directory.
- The CLI's `--resume` flag calls `load_managed_session_for()` to restore a prior session.

### Session Forking

`Session::fork(branch_name)` creates a new session with:
- A fresh `session_id` and timestamps.
- All messages and compaction metadata cloned from the parent.
- A `SessionFork { parent_session_id, branch_name }` for lineage tracking.
- The workspace root is inherited.
- Persistence is NOT inherited (the fork starts without a file path).

`SessionStore::fork_session()` additionally binds the fork to the store's namespace and persists it.

## Compaction & Compression (how long conversations are managed)

### Auto-Compaction Trigger

After the inner loop completes (all tool uses resolved, model response finalized), `maybe_auto_compact()` checks:
- `usage_tracker.cumulative_usage().input_tokens >= auto_compaction_input_tokens_threshold`
- Default threshold: `DEFAULT_AUTO_COMPACTION_INPUT_TOKENS_THRESHOLD` = **100,000** tokens.
- Overridable via `CLAUDE_CODE_AUTO_COMPACT_INPUT_TOKENS` env var or `.with_auto_compaction_input_tokens_threshold()` builder.

If triggered, it calls `compact_session()` with `max_estimated_tokens: 0` (compact everything possible) and replaces `self.session` with the compacted result.

### Manual Compaction

`ConversationRuntime::compact(config)` is exposed publicly for on-demand compaction (e.g., the `/compact` slash command). The caller supplies a `CompactionConfig` with custom `preserve_recent_messages` and `max_estimated_tokens`.

### Compaction Algorithm (`compact_session()`)

1. **Guard**: `should_compact()` checks if compaction is warranted:
   - If there's an existing compaction summary (System-role message at index 0), skip it when counting.
   - The compactable region must have more messages than `preserve_recent_messages`.
   - The compactable region must have >= `max_estimated_tokens` estimated tokens (using byte-length / 4 + 1 heuristic).

2. **Boundary protection**: The keep-from boundary is walked back to avoid splitting a ToolUse/ToolResult pair. If the first preserved message starts with a `ContentBlock::ToolResult`, the boundary is moved earlier to include the corresponding assistant ToolUse message. This prevents the OpenAI-compat adapter from sending orphaned tool-role messages.

3. **Summarize removed messages** (`summarize_messages()`):
   - Counts user/assistant/tool messages.
   - Collects unique tool names.
   - Extracts last 3 user request summaries (truncated to 160 chars).
   - Infers pending work (messages containing "todo", "next", "pending", "follow up", "remaining").
   - Collects key file references (tokens containing `/` with known extensions: rs, ts, tsx, js, json, md).
   - Infers current work from the last non-empty text block.
   - Builds a key timeline listing every removed message with role and truncated content.
   - Wraps everything in `<summary>...</summary>` tags.

4. **Merge summaries**: If a prior compaction summary exists, `merge_compact_summaries()` combines "Previously compacted context" with "Newly compacted context" and the new timeline.

5. **Build continuation message** (`get_compact_continuation_message()`):
   - Prepends: "This session is being continued from a previous conversation that ran out of context."
   - Formats the summary.
   - Appends: "Recent messages are preserved verbatim." (if tail messages exist).
   - Appends: "Continue the conversation from where it left off without asking the user any further questions." (suppress follow-up questions).

6. **Produce compacted session**:
   - Create a System-role message with the continuation text as the first message.
   - Append the preserved tail messages.
   - Clone the original session, replace messages, call `record_compaction()`.

### Summary Compression (`compress_summary()`)

A secondary compression layer that fits summaries within a character/line budget:
- **Normalize**: Collapse inline whitespace, deduplicate lines (case-insensitive), truncate per-line to `max_line_chars` (default 160).
- **Priority selection**: Lines are assigned priority 0-3:
  - Priority 0: "Summary:", "Conversation summary:", core detail lines (Scope, Current work, Pending work, Key files, Tools, etc.)
  - Priority 1: Section headers (lines ending with `:`)
  - Priority 2: Bullet lines (`- ` or `  - `)
  - Priority 3: Everything else
- Lines are selected greedily by priority, checking against `max_chars` (default 1,200) and `max_lines` (default 24) budgets.
- An omission notice is appended if lines were dropped.

### Token Estimation

`estimate_session_tokens()` sums `estimate_message_tokens()` for all messages. Per-message estimation: sum of `content.len() / 4 + 1` for each block's text content. This is a rough byte-based heuristic, not a tokenizer count.

## Integration Points (reference types from docs 01-03 by name)

### ConversationRuntime <-> Configuration (doc 01)

- `ConversationRuntime::new_with_features()` receives `&RuntimeFeatureConfig` (doc 01) and uses it to initialize `HookRunner::from_feature_config()`. The `RuntimeHookConfig` within the feature config provides `pre_tool_use`, `post_tool_use`, and `post_tool_use_failure` hook command lists.
- Auto-compaction threshold is read from `CLAUDE_CODE_AUTO_COMPACT_INPUT_TOKENS` env var at construction time, not from `RuntimeConfig`.

### ConversationRuntime <-> BuiltRuntime / LiveCli (doc 01)

- `BuiltRuntime` (doc 01) wraps `ConversationRuntime<AnthropicRuntimeClient, CliToolExecutor>`. It implements `Deref`/`DerefMut` to the inner runtime.
- `LiveCli` holds a `BuiltRuntime` and manages the session handle. On each turn, `prepare_turn_runtime()` clones the current session from the existing runtime and builds a **new** `BuiltRuntime` (and thus a new `ConversationRuntime`). After the turn succeeds, `replace_runtime()` swaps the new runtime in, discarding the old one.
- This means `ConversationRuntime` is ephemeral per-turn in the CLI — a new one is built for each user input. The `Session` state flows through via cloning.

### ApiClient <-> API Layer (doc 02)

- The `ApiClient` trait is the bridge. `AnthropicRuntimeClient` in main.rs implements it by:
  1. Joining `request.system_prompt` with `"\n\n"` into a single string.
  2. Converting `Vec<ConversationMessage>` to `Vec<InputMessage>` (doc 02 types).
  3. Building a `MessageRequest` (doc 02) with model, max_tokens, tools, tool_choice, stream=true.
  4. Calling `ProviderClient::stream_message()` (doc 02) to get a `MessageStream`.
  5. Polling `MessageStream::next_event()` and collecting `StreamEvent`s (doc 02) into `AssistantEvent`s.
  6. Returning the collected events.
- `AssistantEvent::TextDelta` maps from `StreamEvent::ContentBlockDelta(TextDelta)`.
- `AssistantEvent::ToolUse` maps from `StreamEvent::ContentBlockStart(ToolUse)` + accumulated `InputJsonDelta`s.
- `AssistantEvent::Usage` maps from `StreamEvent::MessageDelta` usage.
- `AssistantEvent::PromptCache` maps from `PromptCacheRecord` (doc 02) via `take_last_prompt_cache_record()`.

### System Prompt (doc 03)

- The `Vec<String>` system prompt built by `SystemPromptBuilder::build()` (doc 03) is stored in `ConversationRuntime.system_prompt`.
- It is cloned into every `ApiRequest` on every iteration of the inner loop.
- The prompt is joined into a single string only in `AnthropicRuntimeClient::stream()` at the wire boundary.
- The prompt is computed once at `LiveCli::new()` and never refreshed across turns (doc 03 open question #3).

### Permission System (doc 01)

- `PermissionPolicy` (doc 01) is stored in `ConversationRuntime.permission_policy`.
- `authorize_with_context()` is called for each tool use, passing the `PermissionContext` from hook results and an optional `PermissionPrompter` for interactive approval.
- The CLI passes `CliPermissionPrompter` (doc 01) as the prompter.

### Hooks (doc 01)

- `HookRunner` is initialized from `RuntimeFeatureConfig` (doc 01) at runtime construction.
- Three hook phases: `run_pre_tool_use_hook()`, `run_post_tool_use_hook()`, `run_post_tool_use_failure_hook()`.
- Hook results can: modify tool input, cancel/deny execution, provide messages that are merged into tool output, override permission decisions.
- `HookAbortSignal` and `HookAbortMonitor` (spawned in the CLI layer) allow external abort of long-running hooks.

### Session Persistence <-> SessionStore (doc 01)

- `SessionStore::from_cwd()` creates the store from the CLI's working directory (doc 01, step 8).
- `create_managed_session_handle()` produces a `SessionHandle` with the JSONL file path.
- The session's `with_persistence_path()` enables incremental JSONL appends during `push_message()`.
- After each turn, `LiveCli::persist_session()` calls `session.save_to_path()` for a full snapshot (redundant with incremental appends but ensures consistency).

### Usage Tracking

- `UsageTracker` is initialized from the session's existing messages at construction: `UsageTracker::from_session(&session)`. This means resumed sessions start with accurate cumulative usage.
- Each API response's `TokenUsage` is recorded via `usage_tracker.record(usage)`.
- Cumulative usage is exposed in `TurnSummary.usage` and drives the auto-compaction threshold check.

### Telemetry

- `SessionTracer` (from the `telemetry` crate) is optionally attached via `with_session_tracer()`.
- Trace events emitted: `turn_started`, `assistant_iteration_completed`, `tool_execution_started`, `tool_execution_finished`, `turn_completed`, `turn_failed`.
- Each event includes structured attributes (iteration number, tool name, error message, etc.).

## Open Questions

1. **Runtime is reconstructed per turn**: `LiveCli::prepare_turn_runtime()` creates a fresh `BuiltRuntime` (and thus MCP state, plugin registry, tool registry) for every single turn by calling `build_runtime()`. This means MCP servers are re-initialized and plugins are re-discovered on each turn. The `replace_runtime()` call then shuts down the old runtime's plugins. This seems expensive — is this intentional for isolation, or is it an architectural limitation?

2. **`run_turn_loop` referenced in issue #159 does not exist**: The git commit message for #159 mentions "run_turn_loop hardcodes empty denied_tools, permission denials absent from multi-turn sessions" but there is no `run_turn_loop` function in the codebase. The actual multi-turn loop is the REPL's `loop { ... cli.run_turn(&trimmed) ... }` in `run_repl()`. The "hardcodes empty denied_tools" concern likely refers to `prepare_turn_runtime()` which passes `None` as the `denied_tools` parameter to `build_runtime()`.

3. **No streaming to the user during tool execution**: The `ApiClient::stream()` trait returns a collected `Vec<AssistantEvent>`, meaning all events are buffered before the conversation loop processes them. The CLI shows a spinner during the API call, not incremental text output. Real-time streaming (showing text deltas as they arrive) happens inside the `AnthropicRuntimeClient::stream()` implementation, but the conversation loop itself only sees the final collected result.

4. **Tools execute sequentially**: When the model returns multiple tool uses in a single response, they are executed sequentially in a `for` loop, not in parallel. This could be a bottleneck for turns with many independent tool calls.

5. **Session clone on every turn**: `prepare_turn_runtime()` clones the entire session (`self.runtime.session().clone()`) before each turn. For long sessions with many messages, this could be expensive. The session is also cloned inside `compact_session()`.

6. **Auto-compaction threshold is cumulative, not per-turn**: The threshold checks `usage_tracker.cumulative_usage().input_tokens` — the sum of all input tokens across all turns since the runtime was created. Since the runtime is recreated per turn but the `UsageTracker` is initialized from the session's existing messages, this cumulative total should be approximately correct. However, after compaction reduces the message count, the cumulative usage still reflects pre-compaction token counts, potentially making the next compaction trigger prematurely.

7. **Health probe uses a specific tool**: The post-compaction health probe calls `tool_executor.execute("glob_search", ...)`. If `glob_search` is not registered in the tool executor, the probe will fail even if the session is healthy. This couples the health check to the availability of a specific tool.

8. **No session locking**: Multiple processes or REPL instances could write to the same session file concurrently. The `write_atomic()` approach (temp file + rename) provides crash safety but not mutual exclusion. The workspace-fingerprinted directories reduce collision probability but don't eliminate it.

9. **Prompt history is recorded in the CLI layer but not in `ConversationRuntime`**: `LiveCli::record_prompt_history()` maintains its own `prompt_history: Vec<PromptHistoryEntry>` separately from `Session.prompt_history`. The session's `push_prompt_entry()` method exists but it's unclear if it's called from the CLI's `record_prompt_history()` — the grep shows the CLI manages its own history vector.

10. **Compaction summary is a static text extraction, not an LLM summary**: The `summarize_messages()` function performs mechanical text extraction (message counts, tool names, recent user requests, key files, timeline) rather than asking the LLM to summarize. This means the quality of context preservation after compaction is limited compared to an LLM-generated summary.

## Key Files Read

| File | Absolute Path |
|------|---------------|
| conversation.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/conversation.rs` |
| session.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/session.rs` |
| session_control.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/session_control.rs` |
| compact.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/compact.rs` |
| summary_compression.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/summary_compression.rs` |
| lib.rs (runtime) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/lib.rs` |
| main.rs (CLI, partial — run_turn, prepare_turn_runtime, replace_runtime, persist_session, run_repl, run_turn_with_output) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/rusty-claude-cli/src/main.rs` |
| usage.rs (partial — TokenUsage, UsageTracker, pricing) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/usage.rs` |

### Files NOT read but referenced (for later agents)

- `runtime/src/hooks.rs` — `HookRunner`, `HookRunResult`, `HookAbortSignal`, hook dispatch logic
- `runtime/src/permissions.rs` — `PermissionPolicy`, `PermissionMode`, `PermissionOutcome`, `PermissionPrompter`, `PermissionContext`
- `tools/` crate — `CliToolExecutor`, `GlobalToolRegistry`, tool implementation details
- `main.rs` (CLI, full) — `build_runtime()`, `AnthropicRuntimeClient::stream()`, slash command handling, session resume logic
- `runtime/src/usage.rs` (full) — `UsageTracker::from_session()`, `record()`, `cumulative_usage()`, cost estimation
