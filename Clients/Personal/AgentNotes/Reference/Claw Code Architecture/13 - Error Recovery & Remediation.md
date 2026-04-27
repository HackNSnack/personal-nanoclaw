# 13 — Error Recovery & Remediation

## Summary (2-3 sentences)

Claw-code's error recovery system operates across three layers: the **API layer** (`ApiError` enum with retryability, failure classification, and context-window detection), the **runtime layer** (recovery recipes for known failure scenarios plus lane-level failure classification), and the **CLI layer** (error kind classification for machine-readable output, hint splitting, and user-visible formatting including recovery suggestions). Recent work on issues #156 and #157 added machine-readable `[error-kind: ...]` prefixes to text-mode stderr output and a structured remediation registry (`recovery_recipes.rs`) that encodes known automatic recovery sequences with one-attempt-before-escalation policy. The system does not yet perform real recovery actions at runtime — recovery steps are simulated/planned — but the classification and hint infrastructure is fully wired for both JSON and text output modes.

## Key Types & Structs

### API Layer (`api/src/error.rs`)

| Type | Description |
|------|-------------|
| `ApiError` (enum) | Comprehensive error type with 10 variants covering credentials, context window, auth, HTTP, I/O, JSON deserialization, provider HTTP errors, retries exhausted, SSE frame errors, backoff overflow, and request body size. Key methods: `is_retryable()`, `safe_failure_class()`, `is_context_window_failure()`, `is_generic_fatal_wrapper()`, `request_id()`. |
| `GENERIC_FATAL_WRAPPER_MARKERS` | Static string array detecting provider-side generic errors ("something went wrong while processing your request"). |
| `CONTEXT_WINDOW_ERROR_MARKERS` | Static string array detecting context window overflow messages across providers ("maximum context length", "too many tokens", etc.). |

### Runtime Layer — Recovery Recipes (`runtime/src/recovery_recipes.rs`)

| Type | Description |
|------|-------------|
| `FailureScenario` (enum) | Seven known failure patterns: `TrustPromptUnresolved`, `PromptMisdelivery`, `StaleBranch`, `CompileRedCrossCrate`, `McpHandshakeFailure`, `PartialPluginStartup`, `ProviderFailure`. |
| `RecoveryStep` (enum) | Concrete recovery actions: `AcceptTrustPrompt`, `RedirectPromptToAgent`, `RebaseBranch`, `CleanBuild`, `RetryMcpHandshake { timeout }`, `RestartPlugin { name }`, `RestartWorker`, `EscalateToHuman { reason }`. |
| `RecoveryRecipe` | Links a `FailureScenario` to a sequence of `RecoveryStep`s, a `max_attempts` count, and an `EscalationPolicy`. |
| `EscalationPolicy` (enum) | `AlertHuman`, `LogAndContinue`, `Abort`. |
| `RecoveryResult` (enum) | `Recovered { steps_taken }`, `PartialRecovery { recovered, remaining }`, `EscalationRequired { reason }`. |
| `RecoveryEvent` (enum) | Structured event log: `RecoveryAttempted { scenario, recipe, result }`, `RecoverySucceeded`, `RecoveryFailed`, `Escalated`. All variants are `Serialize`/`Deserialize`. |
| `RecoveryContext` | Mutable state holder: per-scenario attempt counts (`HashMap<FailureScenario, u32>`), structured event log (`Vec<RecoveryEvent>`), optional `fail_at_step` simulation knob for tests. |

### Runtime Layer — Lane Failure Classification (`runtime/src/lane_events.rs`)

| Type | Description |
|------|-------------|
| `LaneFailureClass` (enum) | 12-variant taxonomy: `PromptDelivery`, `TrustGate`, `BranchDivergence`, `Compile`, `Test`, `PluginStartup`, `McpStartup`, `McpHandshake`, `GatewayRouting`, `ToolRuntime`, `WorkspaceMismatch`, `Infra`. |
| `LaneEventBlocker` | Carries `failure_class: LaneFailureClass`, `detail: String`, optional `subphase: BlockedSubphase`. Used by `LaneEvent::blocked()` and `LaneEvent::failed()`. |
| `BlockedSubphase` (enum) | Fine-grained sub-classification: `TrustPrompt`, `PromptDelivery`, `PluginInit`, `McpHandshake`, `BranchFreshness`, `TestHang`, `ReportPending`. |

### Runtime Layer — Core Error Types (`runtime/src/conversation.rs`)

| Type | Description |
|------|-------------|
| `RuntimeError` | Simple `message: String` wrapper. Returned from `ConversationRuntime::run_turn()`. Does not carry structured classification — the string is the user-visible message. |
| `ToolError` | Simple `message: String` wrapper. Returned from `ToolExecutor::execute()`. Converted to `ContentBlock::ToolResult { is_error: true }` by the conversation loop. |

### Runtime Layer — Worker Failure Bridge (`runtime/src/worker_boot.rs`)

| Type | Description |
|------|-------------|
| `WorkerFailureKind` (enum) | `TrustGate`, `PromptDelivery`, `Protocol`, `Provider`, `StartupNoEvidence`. |
| `WorkerFailure` | Carries `kind: WorkerFailureKind`, `message: String`, `created_at: u64`. |
| `FailureScenario::from_worker_failure_kind()` | Bridge method mapping `WorkerFailureKind` to `FailureScenario` for recovery recipe lookup. |

### CLI Layer (`rusty-claude-cli/src/main.rs`)

| Function | Description |
|----------|-------------|
| `classify_error_kind(&str) -> &'static str` | Best-effort prefix/keyword matching on stringified error messages. Returns snake_case tokens: `missing_credentials`, `missing_manifests`, `missing_worker_state`, `session_not_found`, `session_load_failed`, `no_managed_sessions`, `cli_parse`, `invalid_model_syntax`, `unsupported_command`, `unsupported_resumed_command`, `confirmation_required`, `api_http_error`, `unknown`. |
| `split_error_hint(&str) -> (String, Option<String>)` | Splits multi-line error messages at the first newline into (short_reason, optional_hint). Prevents runbook prose from being stuffed into the `error` field. |
| `format_user_visible_api_error(session_id, &ApiError) -> String` | Formats API errors for the user: context window errors get detailed recovery blocks, generic fatal wrappers get failure class + trace qualifiers, others use `Display`. |
| `format_context_window_blocked_error(session_id, &ApiError) -> String` | Builds a structured multi-line error with token budget details and a "Recovery" section listing `/compact`, resume commands, and scope reduction advice. |

## Error Classification (how errors are categorized)

### Three-Level Classification System

**Level 1 — `ApiError::safe_failure_class()` (API layer)**

Returns static string tokens for telemetry and downstream routing:

| Failure Class | Triggered By |
|---------------|-------------|
| `"context_window"` | `ContextWindowExceeded`, provider 400/413/422 with context window markers, `RetriesExhausted` wrapping same |
| `"provider_auth"` | `MissingCredentials`, `ExpiredOAuthToken`, `Auth`, provider 401/403 |
| `"provider_rate_limit"` | Provider 429 |
| `"provider_internal"` | `Api` with generic fatal wrapper markers |
| `"provider_error"` | Other `Api` errors |
| `"provider_retry_exhausted"` | `RetriesExhausted` wrapping generic fatal wrapper |
| `"provider_transport"` | `Http`, `InvalidSseFrame`, `BackoffOverflow` |
| `"runtime_io"` | `InvalidApiKeyEnv`, `Io`, `Json` |
| `"request_size"` | `RequestBodySizeExceeded` |

Note: `RetriesExhausted` delegates to `last_error.safe_failure_class()` when not matching context window or generic fatal patterns.

**Level 2 — `classify_error_kind()` (CLI layer)**

Operates on the stringified error message (after `Display` formatting) rather than on the typed error. This is the user-facing classification that appears in `[error-kind: ...]` prefixes and JSON `kind` fields. 13 named kinds plus `"unknown"` fallback.

**Level 3 — `LaneFailureClass` (runtime layer)**

12-variant enum used in lane events for multi-agent orchestration. More granular than the API-level classification (distinguishes `McpStartup` vs `McpHandshake`, `PluginStartup` vs `GatewayRouting`, `Compile` vs `Test`).

### Retryability

`ApiError::is_retryable()` determines automatic retry eligibility:
- **Retryable**: HTTP connect/timeout/request errors; `Api` errors with `retryable: true`; `RetriesExhausted` delegates to inner.
- **Not retryable**: All credential errors, context window, SSE parse errors, body size exceeded, I/O, backoff overflow.

The retry loop itself is in the Anthropic/OpenAI-compat clients (doc 02) with exponential backoff + jitter, up to `max_retries` (default 8).

### Context Window Detection

Two-pronged detection:
1. **Pre-flight (local)**: `preflight_message_request()` estimates tokens from request byte length / 4 and rejects before sending. Returns `ContextWindowExceeded` with full token budget breakdown.
2. **Provider-side**: `is_context_window_failure()` keyword-matches provider error messages against `CONTEXT_WINDOW_ERROR_MARKERS` for HTTP 400/413/422 responses.

### Generic Fatal Wrapper Detection

`is_generic_fatal_wrapper()` detects Anthropic's "something went wrong" catch-all errors via `GENERIC_FATAL_WRAPPER_MARKERS`. These get classified as `"provider_internal"` and receive special formatting.

## Recovery Recipes (what known failure patterns have auto-recovery?)

The recovery recipe system (`runtime/src/recovery_recipes.rs`) encodes seven known failure scenarios with pre-defined recovery sequences:

| Scenario | Steps | Max Attempts | Escalation |
|----------|-------|-------------|------------|
| `TrustPromptUnresolved` | `AcceptTrustPrompt` | 1 | `AlertHuman` |
| `PromptMisdelivery` | `RedirectPromptToAgent` | 1 | `AlertHuman` |
| `StaleBranch` | `RebaseBranch` → `CleanBuild` | 1 | `AlertHuman` |
| `CompileRedCrossCrate` | `CleanBuild` | 1 | `AlertHuman` |
| `McpHandshakeFailure` | `RetryMcpHandshake { timeout: 5000 }` | 1 | `Abort` |
| `PartialPluginStartup` | `RestartPlugin { name: "stalled" }` → `RetryMcpHandshake { timeout: 3000 }` | 1 | `LogAndContinue` |
| `ProviderFailure` | `RestartWorker` | 1 | `AlertHuman` |

### Recovery Execution Model

`attempt_recovery(scenario, ctx)` follows this flow:
1. Look up the recipe via `recipe_for(scenario)`.
2. Check if `attempt_count >= max_attempts` — if so, return `EscalationRequired` immediately and emit `Escalated` event.
3. Increment attempt counter.
4. Execute steps sequentially (currently simulated — a `fail_at_step` index controls test outcomes).
5. On full success: return `Recovered { steps_taken }`, emit `RecoverySucceeded`.
6. On mid-sequence failure: return `PartialRecovery` (if at least one step succeeded) or `EscalationRequired` (if first step failed), emit `RecoveryFailed` or `Escalated`.
7. All outcomes emit `RecoveryAttempted { scenario, recipe, result }` as structured JSON-serializable events.

### Worker Failure Bridge

`FailureScenario::from_worker_failure_kind()` maps worker boot failures to recovery scenarios:
- `TrustGate` → `TrustPromptUnresolved`
- `PromptDelivery` → `PromptMisdelivery`
- `Protocol` → `McpHandshakeFailure`
- `Provider` / `StartupNoEvidence` → `ProviderFailure`

### Current Limitation

Recovery steps are **not actually executed** at runtime. The `attempt_recovery()` function simulates step execution — it walks the step list and checks the `fail_at_step` simulation knob. Real recovery actions (e.g., actually rebasing a branch, restarting an MCP server) would need to be wired into the step execution loop. This is a planned, not yet implemented, feature.

## Remediation Hints (how the system suggests fixes to users)

### Structured Hint System (#157)

The recovery recipe registry (described above) is the "structured remediation registry" from #157. Each `RecoveryRecipe` encodes not just what to try, but what to tell the user if recovery fails (via `EscalationPolicy`).

### API-Level Hints

1. **`MissingCredentials` with `hint`**: The `ApiError::MissingCredentials` variant carries an optional runtime-computed hint. For example, when Anthropic credentials are missing but `OPENAI_API_KEY` is set, the hint says: "I see OPENAI_API_KEY is set — if you meant to use the OpenAI-compat provider, prefix your model name with `openai/`". This is produced by `anthropic_missing_credentials()` in `providers/mod.rs`.

2. **`suggested_action` on `Api` errors**: The `ApiError::Api` variant carries an optional `suggested_action: Option<String>` for provider-specific remediation (e.g., "Reduce prompt size" for 413 errors). This field is populated during `expect_success()` response parsing.

3. **Context window recovery block**: `format_context_window_blocked_error()` generates a multi-line remediation block:
   ```
   Context window blocked
     Failure class    context_window_blocked
     Session          <session_id>
     Model            <model>
     Input estimate   ~N tokens (heuristic)
     ...
   
   Recovery
     Compact          /compact
     Resume compact   claw --resume <session_id> /compact
     Fresh session    /clear --confirm
     Reduce scope     remove large pasted context/files or ask for a smaller slice
     Retry            rerun after compacting or reducing the request
   ```

### CLI-Level Hint Splitting (#77)

`split_error_hint()` separates the short error reason from the runbook/hint prose at the first newline boundary. In JSON output mode, this becomes:
```json
{
  "type": "error",
  "error": "short reason line",
  "kind": "missing_credentials",
  "hint": "Hint: export ANTHROPIC_API_KEY before calling..."
}
```

In text output mode, the full message is emitted with the `[error-kind: ...]` prefix prepended (added in #156).

## Error Display (how errors are rendered in the terminal)

### Text Mode Error Display

Three distinct rendering paths in the CLI:

**1. Top-level `main()` errors (process exit)**
```
[error-kind: missing_credentials]
error: missing Anthropic credentials; export ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY...

Run `claw --help` for usage.
```
The `[error-kind: ...]` prefix (#156) enables machine-readable classification without requiring JSON output mode. If the error message already contains `` `claw --help` ``, the help footer is suppressed.

**2. REPL turn errors**
When `run_turn()` fails, the spinner shows `"❌ Request failed"` (red color via `Spinner::fail()`), and the `RuntimeError` propagates up through `Box<dyn Error>` to the REPL loop. The REPL currently does not catch turn errors gracefully — they propagate to `run_repl()` and exit.

**3. Inline errors during turns**
Tool execution errors are returned as `ContentBlock::ToolResult { is_error: true }` in the conversation — they go back to the model as error feedback, not displayed directly to the user. The model sees the error and decides what to do.

### JSON Mode Error Display

```json
{
  "type": "error",
  "error": "short reason (first line)",
  "kind": "api_http_error",
  "hint": "optional remediation text"
}
```

This structured format is produced for both top-level `main()` errors and session load errors.

### Spinner States

`render.rs` provides three spinner terminal states:
- **Active**: Blue spinner frames (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) with label (e.g., "Thinking...")
- **Done**: Green `✔` with label (e.g., "Done")
- **Failed**: Red `✘` with label (e.g., "Request failed")

### API Error Formatting

`format_user_visible_api_error()` applies special formatting based on error type:
1. **Context window failures** → `format_context_window_blocked_error()` with full recovery block.
2. **Generic fatal wrappers** → `"<failure_class> (session <id>, trace <request_id>): <message>"`.
3. **All others** → `ApiError::Display` impl (standard `.to_string()`).

The `ApiError::Display` impl formats each variant differently:
- `MissingCredentials`: canonical message with env var names, Windows-specific guidance, optional hint
- `ContextWindowExceeded`: token budget breakdown with model name
- `Api`: status code + error_type + message + optional trace ID
- `RetriesExhausted`: "api failed after N attempts: <last_error>"
- `RequestBodySizeExceeded`: byte counts with provider name
- `Json`: provider + model + truncated body snippet (first 200 chars)

## Integration Points (reference types from docs 02, 04, 05)

### API Layer → Conversation Loop (docs 02, 04)

- `ApiError` (doc 02) is converted to `RuntimeError` (doc 04) at the `ApiClient::stream()` boundary in `AnthropicRuntimeClient::stream()`. The conversion calls `format_user_visible_api_error()` to produce a human-readable string, losing the typed error information.
- `ApiError::is_retryable()` drives the retry loop inside `AnthropicClient` and `OpenAiCompatClient` (doc 02) — the conversation loop never sees retryable errors unless retries are exhausted.
- `ApiError::safe_failure_class()` is used for telemetry via `SessionTracer` (doc 02) and for formatting via `format_user_visible_api_error()`.

### Tool Execution → Conversation Loop (docs 04, 05)

- `ToolError` (doc 04) from `ToolExecutor::execute()` (doc 05) is wrapped into `ConversationMessage::tool_result(..., is_error: true)` and pushed back to the session. The model receives the error as a tool result and may retry or respond with text. Tool errors do NOT terminate the turn.
- Permission denials (doc 04) also produce error tool results — the model sees "permission denied" and the loop continues.

### Recovery Recipes → Worker Boot (runtime)

- `WorkerFailureKind` (worker_boot.rs) maps to `FailureScenario` (recovery_recipes.rs) via `FailureScenario::from_worker_failure_kind()`. This is the bridge between worker lifecycle events and the recovery system.
- `RecoveryContext` tracks per-scenario attempt counts and emits structured `RecoveryEvent`s.

### Lane Events → Failure Classification (runtime)

- `LaneFailureClass` (lane_events.rs) is attached to `LaneEvent`s via `LaneEventBlocker`. These events are used by the multi-agent orchestration layer.
- `BlockedSubphase` provides fine-grained context for blockers (which MCP server failed, how many attempts, etc.).

### CLI Error Display → TerminalRenderer (CLI)

- `Spinner` (render.rs) provides the visual feedback for in-progress, success, and failure states during turns.
- `TerminalRenderer` (render.rs) handles markdown rendering for assistant output but is NOT used for error rendering — errors use `eprintln!` directly.

### Error Type Lossy Conversion Chain

```
ApiError (typed, rich)
  → format_user_visible_api_error() → String (formatted, some structure)
    → RuntimeError { message: String } (flat string, all type info lost)
      → Box<dyn Error> (erased)
        → eprintln! or JSON output (final display)
```

This means the CLI layer's `classify_error_kind()` must re-parse the stringified error message to recover classification, since the typed `ApiError` information was lost during the `RuntimeError` conversion.

## Open Questions

1. **Recovery steps are simulated, not executed**: `attempt_recovery()` walks the step list but does not actually perform recovery actions (no real rebase, no real MCP restart). The `fail_at_step` simulation knob exists only for tests. When will real recovery execution be wired in?

2. **Lossy error type conversion**: `ApiError` is converted to `RuntimeError(String)` at the `ApiClient` boundary, losing all typed information. The CLI layer then re-classifies by string matching. This means `classify_error_kind()` and `safe_failure_class()` can diverge — they are independent classification systems operating on different representations of the same error. Should `RuntimeError` carry structured error metadata?

3. **REPL does not catch turn errors**: `run_turn()` errors propagate through `Box<dyn Error>` to the REPL loop's `?` operator, which exits `run_repl()`. This means any API failure in REPL mode terminates the entire session. Is this intentional, or should the REPL catch and display turn errors while continuing?

4. **No recovery recipe integration with the conversation loop**: The recovery recipe system exists in the runtime crate but is not wired into `ConversationRuntime::run_turn()`. When an API call fails, the conversation loop returns `RuntimeError` — it does not consult recovery recipes. The recipes are currently only useful for the worker/lane orchestration layer.

5. **`classify_error_kind()` coverage**: The function matches 13 specific patterns. Any error message that doesn't match a known pattern returns `"unknown"`. As new error paths are added, this function needs manual updates. There's no compile-time guarantee that all error paths are covered.

6. **MCP retry is separate from API retry**: `McpServerManager::is_retryable_error()` has its own retryability logic (retryable: `Transport`, `Timeout`; not retryable: others). This is independent of `ApiError::is_retryable()`. There's no unified retry policy.

7. **No structured error events in session persistence**: Recovery events (`RecoveryEvent`) are serializable but are not persisted to the session JSONL file. If a recovery attempt occurs during a turn, the event is emitted to the `RecoveryContext` but not recorded in the session history for post-mortem analysis.

8. **`FailureScenario` and `LaneFailureClass` partial overlap**: Both enums classify failures but with different granularity and purpose. `FailureScenario` (7 variants, recovery-oriented) and `LaneFailureClass` (12 variants, event-oriented) overlap conceptually but have no formal mapping between them. For example, `LaneFailureClass::McpHandshake` maps to `FailureScenario::McpHandshakeFailure`, but `LaneFailureClass::Test` has no corresponding `FailureScenario`.

## Key Files Read

| File | Absolute Path |
|------|---------------|
| error.rs (API) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/api/src/error.rs` |
| recovery_recipes.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/recovery_recipes.rs` |
| lane_events.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/lane_events.rs` |
| worker_boot.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/worker_boot.rs` |
| conversation.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/conversation.rs` |
| lib.rs (runtime) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/lib.rs` |
| render.rs (CLI) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/rusty-claude-cli/src/render.rs` |
| main.rs (CLI, partial) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/rusty-claude-cli/src/main.rs` |
