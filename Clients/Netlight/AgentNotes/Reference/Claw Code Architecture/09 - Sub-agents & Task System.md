# 09 — Sub-agents & Task System

> Claw Code architecture investigation — Sub-agent spawning, task tracking, worker boot lifecycle, team/cron orchestration, and lane event coordination.

---

## Summary

The sub-agent and task system provides four layers of multi-agent capability: (1) **Agent** — the primary sub-agent tool that spawns a background `ConversationRuntime` on a dedicated thread with a restricted tool set; (2) **Task** — an in-memory registry for tracking background work items with lifecycle states and output accumulation; (3) **Worker** — a sophisticated state machine for managing external coding-agent processes with trust-gate detection, prompt-misdelivery recovery, and file-based observability; and (4) **Team/Cron** — lightweight registries for grouping tasks into teams and scheduling recurring prompts. Lane events provide a cross-cutting event vocabulary for multi-lane coordination, failure classification, commit provenance tracking, and terminal event deduplication.

All four subsystems use process-level `OnceLock` singleton registries backed by `Arc<Mutex<HashMap>>`, meaning they persist across tool calls within a single process lifetime but are not durable across process restarts.

---

## Key Types & Structs

### Task System (`runtime/src/task_registry.rs`, `runtime/src/task_packet.rs`)

| Type | Description |
|------|-------------|
| `TaskRegistry` | `Arc<Mutex<RegistryInner>>` — in-memory task store with create/get/list/stop/update/output/remove/set_status/assign_team operations |
| `Task` | Core task record: `task_id`, `prompt`, `description`, `task_packet`, `status`, `created_at`, `updated_at`, `messages: Vec<TaskMessage>`, `output: String`, `team_id` |
| `TaskStatus` | Enum: `Created`, `Running`, `Completed`, `Failed`, `Stopped` |
| `TaskMessage` | Timestamped message appended to a task: `role`, `content`, `timestamp` |
| `TaskPacket` | Structured task definition: `objective`, `scope: TaskScope`, `scope_path`, `repo`, `worktree`, `branch_policy`, `acceptance_tests`, `commit_policy`, `reporting_contract`, `escalation_policy` |
| `TaskScope` | Enum: `Workspace`, `Module`, `SingleFile`, `Custom` |
| `ValidatedPacket` | Newtype wrapper ensuring a `TaskPacket` has passed `validate_packet()` |
| `TaskPacketValidationError` | Accumulating validation errors (non-empty fields, scope-path requirements) |

### Worker System (`runtime/src/worker_boot.rs`)

| Type | Description |
|------|-------------|
| `WorkerRegistry` | `Arc<Mutex<WorkerRegistryInner>>` — in-memory worker store with full lifecycle management |
| `Worker` | Core worker record: `worker_id`, `cwd`, `status`, trust/prompt state flags, `events: Vec<WorkerEvent>`, `last_error`, `expected_receipt`, `replay_prompt` |
| `WorkerStatus` | Enum: `Spawning`, `TrustRequired`, `ReadyForPrompt`, `Running`, `Finished`, `Failed` |
| `WorkerFailureKind` | Enum: `TrustGate`, `PromptDelivery`, `Protocol`, `Provider`, `StartupNoEvidence` |
| `WorkerFailure` | `kind: WorkerFailureKind`, `message: String`, `created_at: u64` |
| `WorkerEventKind` | Enum: `Spawning`, `TrustRequired`, `TrustResolved`, `ReadyForPrompt`, `PromptMisdelivery`, `PromptReplayArmed`, `Running`, `Restarted`, `Finished`, `Failed`, `StartupNoEvidence` |
| `WorkerEventPayload` | Tagged union: `TrustPrompt { cwd, resolution }`, `PromptDelivery { prompt_preview, observed_target, ... }`, `StartupNoEvidence { evidence, classification }` |
| `WorkerReadySnapshot` | Polled readiness view: `ready`, `blocked`, `replay_prompt_ready`, `last_error` |
| `WorkerTaskReceipt` | Task receipt for prompt delivery validation: `repo`, `task_kind`, `source_surface`, `expected_artifacts`, `objective_preview` |
| `StartupEvidenceBundle` | Diagnostic bundle: `last_lifecycle_state`, `pane_command`, `prompt_sent_at`, transport/MCP health, `elapsed_seconds` |
| `StartupFailureClassification` | Enum: `TrustRequired`, `PromptMisdelivery`, `PromptAcceptanceTimeout`, `TransportDead`, `WorkerCrashed`, `Unknown` |

### Team & Cron (`runtime/src/team_cron_registry.rs`)

| Type | Description |
|------|-------------|
| `TeamRegistry` | `Arc<Mutex<TeamInner>>` — team CRUD with soft delete |
| `Team` | `team_id`, `name`, `task_ids: Vec<String>`, `status: TeamStatus`, timestamps |
| `TeamStatus` | Enum: `Created`, `Running`, `Completed`, `Deleted` |
| `CronRegistry` | `Arc<Mutex<CronInner>>` — cron entry CRUD + run tracking |
| `CronEntry` | `cron_id`, `schedule`, `prompt`, `description`, `enabled`, `run_count`, `last_run_at` |

### Lane Events (`runtime/src/lane_events.rs`)

| Type | Description |
|------|-------------|
| `LaneEvent` | Core event: `event: LaneEventName`, `status: LaneEventStatus`, `emitted_at`, optional `failure_class`, `detail`, `data`, `metadata: LaneEventMetadata` |
| `LaneEventName` | 21 event types: `Started`, `Ready`, `PromptMisdelivery`, `Blocked`, `Red`, `Green`, `CommitCreated`, `PrOpened`, `MergeReady`, `Finished`, `Failed`, `Reconciled`, `Merged`, `Superseded`, `Closed`, `BranchStaleAgainstMain`, `BranchWorkspaceMismatch`, `ShipPrepared`, `ShipCommitsSelected`, `ShipMerged`, `ShipPushedMain` |
| `LaneEventStatus` | Enum: `Running`, `Ready`, `Blocked`, `Red`, `Green`, `Completed`, `Failed`, `Reconciled`, `Merged`, `Superseded`, `Closed` |
| `LaneFailureClass` | 12-variant taxonomy: `PromptDelivery`, `TrustGate`, `BranchDivergence`, `Compile`, `Test`, `PluginStartup`, `McpStartup`, `McpHandshake`, `GatewayRouting`, `ToolRuntime`, `WorkspaceMismatch`, `Infra` |
| `LaneEventMetadata` | `seq`, `provenance`, optional `session_identity`, `ownership`, `nudge_id`, `event_fingerprint`, `timestamp_ms` |
| `EventProvenance` | Enum: `LiveLane`, `Test`, `Healthcheck`, `Replay`, `Transport` |
| `LaneEventBuilder` | Builder pattern for constructing events with metadata, fingerprints, ownership |
| `LaneCommitProvenance` | Commit metadata: `commit`, `branch`, `worktree`, `canonical_commit`, `superseded_by`, `lineage` |
| `ShipProvenance` | Ship/merge metadata: `source_branch`, `base_commit`, `commit_count`, `merge_method`, `actor`, `pr_number` |
| `BlockedSubphase` | 7-variant sub-classification of `Blocked`: `TrustPrompt`, `PromptDelivery`, `PluginInit`, `McpHandshake`, `BranchFreshness`, `TestHang`, `ReportPending` |
| `LaneEventBlocker` | `failure_class`, `detail`, optional `subphase` |

### Agent Sub-system (`tools/src/lib.rs`)

| Type | Description |
|------|-------------|
| `AgentInput` | `description`, `prompt`, optional `subagent_type`, `name`, `model` |
| `AgentOutput` | Manifest: `agent_id`, `name`, `description`, `subagent_type`, `model`, `status`, `output_file`, `manifest_file`, timestamps, `lane_events: Vec<LaneEvent>`, `current_blocker`, `derived_state`, `error` |
| `AgentJob` | Internal: `manifest: AgentOutput`, `prompt`, `system_prompt: Vec<String>`, `allowed_tools: BTreeSet<String>` |
| `ProviderRuntimeClient` | `ApiClient` impl for sub-agents: `tokio::runtime::Runtime`, `chain: Vec<ProviderEntry>`, `allowed_tools` — provides fallback provider chain |
| `SubagentToolExecutor` | `ToolExecutor` impl for sub-agents: `allowed_tools: BTreeSet<String>`, optional `PermissionEnforcer` — rejects tools not in allowlist |

---

## Task Registry (how tasks are tracked, their lifecycle)

### Data Model

Tasks are stored in `TaskRegistry`, an `Arc<Mutex<HashMap<String, Task>>>`. Each task has a unique ID generated as `task_{timestamp_hex}_{counter}`. The registry is a process-level `OnceLock` singleton (`global_task_registry()`), meaning all tool calls within a session share the same task store.

### Lifecycle States

```
Created  →  Running  →  Completed
                    →  Failed
                    →  Stopped
```

- **Created**: Initial state when `create()` or `create_from_packet()` is called.
- **Running**: Set externally via `set_status()` — the registry itself never transitions to Running automatically.
- **Completed/Failed**: Terminal success/failure states.
- **Stopped**: Terminal state from `stop()` — only valid from `Created` or `Running`. Attempting to stop a task in `Completed`, `Failed`, or `Stopped` returns an error.

### Operations

| Method | Behavior |
|--------|----------|
| `create(prompt, description)` | Creates a basic task, returns `Task` |
| `create_from_packet(TaskPacket)` | Validates packet, creates task with structured metadata |
| `get(task_id)` | Returns `Option<Task>` (cloned) |
| `list(status_filter)` | Returns all tasks, optionally filtered by status |
| `stop(task_id)` | Transitions to `Stopped` if not in terminal state |
| `update(task_id, message)` | Appends a `TaskMessage` (role="user") to the task |
| `output(task_id)` | Returns accumulated output string |
| `append_output(task_id, text)` | Appends to the task's output buffer |
| `set_status(task_id, status)` | Direct status override (no state machine enforcement) |
| `assign_team(task_id, team_id)` | Links task to a team |
| `remove(task_id)` | Hard-removes task from the registry |

### TaskPacket (Structured Task Definitions)

`TaskPacket` provides a formalized task specification with:
- **Objective**: What the task should accomplish.
- **Scope**: Granularity (`Workspace`, `Module`, `SingleFile`, `Custom`) with optional `scope_path`.
- **Repo/Worktree**: Repository context and optional worktree path.
- **Branch/Commit/Escalation policies**: Textual policies for the sub-agent to follow.
- **Acceptance tests**: List of commands to verify completion.
- **Reporting contract**: How the agent should report results.

Validation (`validate_packet()`) accumulates errors: all required string fields must be non-empty, `scope_path` is mandatory for non-Workspace scopes, and acceptance test entries cannot be blank.

### Tool Interface

Seven tools interact with the task registry:

| Tool | Handler | Registry Method |
|------|---------|-----------------|
| `TaskCreate` | `run_task_create` | `create()` |
| `RunTaskPacket` | `run_task_packet` | `create_from_packet()` |
| `TaskGet` | `run_task_get` | `get()` |
| `TaskList` | `run_task_list` | `list(None)` — always unfiltered |
| `TaskStop` | `run_task_stop` | `stop()` |
| `TaskUpdate` | `run_task_update` | `update()` |
| `TaskOutput` | `run_task_output` | `output()` |

All handlers are thin wrappers: deserialize input, call the global registry singleton, serialize result to JSON.

---

## Worker Boot (the worker state machine — states, transitions)

### State Machine Overview

The worker boot system manages the lifecycle of external coding-agent processes (e.g., another `claw` instance running in a tmux pane). It handles trust prompts, prompt delivery verification, misdelivery recovery, and session completion classification.

### States

```
Spawning  ──(trust prompt detected)──→  TrustRequired
    │                                       │
    │                                  (auto-resolved or manual)
    │                                       │
    ├──(ready cue detected)──→  ReadyForPrompt
    │                               │
    │                          (send_prompt)
    │                               │
    └──────────────────────→  Running
                                │         │
                           (finished) (provider error / misdelivery)
                                │         │
                            Finished    Failed
                                        │
                                   (restart)
                                        │
                                    Spawning
```

### State Details

1. **Spawning** — Initial state. Worker process has been launched but not yet ready. The `observe()` method watches screen text for cues.

2. **TrustRequired** — A trust prompt was detected in the screen text (matched by `detect_trust_prompt()` checking for phrases like "do you trust the files in this folder"). Two resolution paths:
   - **Auto-resolve**: If `trust_auto_resolve` is true (the worker's `cwd` is under a trusted root from config), the trust gate is cleared immediately and the worker returns to `Spawning`.
   - **Manual resolve**: `resolve_trust()` must be called explicitly, clearing the trust gate and returning to `Spawning`.

3. **ReadyForPrompt** — Detected by `detect_ready_for_prompt()` looking for text cues like "ready for input", "send a message", or prompt characters (`>`, `›`, `❯`). Shell prompts (`$`, `%`, `#`) are explicitly excluded to avoid false positives.

4. **Running** — After `send_prompt()` dispatches a prompt. The `prompt_in_flight` flag tracks whether the prompt has been acknowledged. Running cues ("thinking", "working", "analyzing") clear the in-flight flag.

5. **Finished** — Terminal success via `terminate()` or `observe_completion()` with a non-degraded finish reason.

6. **Failed** — Terminal failure from: prompt misdelivery, provider error (finish="unknown" with zero tokens), startup timeout, or explicit failure.

### Key Mechanisms

**Trust Gate Detection**: `detect_trust_prompt()` matches lowered screen text against 5 needle phrases. If the worker's `cwd` is under a trusted root (checked via `path_matches_allowlist()` which canonicalizes and prefix-matches paths), trust is auto-resolved.

**Prompt Misdelivery Detection**: When `prompt_in_flight` is true and `last_prompt` is set, `detect_prompt_misdelivery()` checks for:
- **Shell misdelivery**: Prompt text visible in screen + shell error messages ("command not found", "syntax error", etc.).
- **Wrong target**: Prompt text visible + observed CWD doesn't match expected CWD.
- **Wrong task**: Task receipt tokens not visible when expected receipt is set, or observed prompt differs from expected.

**Prompt Replay**: When `auto_recover_prompt_misdelivery` is enabled and a misdelivery is detected, `replay_prompt` is set to the last prompt, and the worker transitions to `ReadyForPrompt`. The next `send_prompt(None)` call replays the saved prompt.

**Session Completion Classification**: `observe_completion(finish_reason, tokens_output)` distinguishes:
- Provider failure: `finish="unknown"` with 0 tokens, or `finish="error"` → `Failed` with `WorkerFailureKind::Provider`.
- Normal completion: Any other combination → `Finished`.

**Startup Timeout**: `observe_startup_timeout()` collects a `StartupEvidenceBundle` and classifies the failure using `classify_startup_failure()`:
- Transport dead → `TransportDead`
- Trust prompt detected and unresolved → `TrustRequired`
- Prompt sent but not accepted, status is Running → `PromptAcceptanceTimeout`
- Prompt sent but not accepted, >30s elapsed → `PromptMisdelivery`
- MCP unhealthy but transport healthy → `WorkerCrashed`
- Default → `Unknown`

**File-Based Observability**: Every state transition calls `emit_state_file()`, which atomically writes a `StateSnapshot` JSON to `{cwd}/.claw/worker-state.json`. This provides an out-of-band observability surface for external tools (like "clawhip") to poll worker status without needing an HTTP route.

### Event Audit Trail

Every worker state change is recorded as a `WorkerEvent` with:
- Monotonic `seq` number
- `kind: WorkerEventKind`
- `status: WorkerStatus` (the new status after the event)
- Optional `detail: String`
- Optional `payload: WorkerEventPayload` (typed structured data)
- `timestamp: u64`

---

## Sub-agent Execution (how a Task tool spawns a sub-conversation)

### Agent Tool Flow

The `Agent` tool is the primary mechanism for spawning sub-agents. The flow:

1. **Input validation**: `execute_agent()` checks that `description` and `prompt` are non-empty.

2. **Agent setup**:
   - Generate unique `agent_id` (nanosecond timestamp: `agent-{nanos}`).
   - Resolve agent store directory: `$CLAWD_AGENT_STORE` env var, or `{workspace_root}/.clawd-agents/`.
   - Create output file (`{agent_id}.md`) and manifest file (`{agent_id}.json`).
   - Normalize `subagent_type` and resolve tool allowlist via `allowed_tools_for_subagent()`.
   - Build system prompt via `build_agent_system_prompt()`.

3. **Manifest creation**: An `AgentOutput` manifest is written to the JSON file with status "running" and an initial `lane.started` event.

4. **Thread spawn**: `spawn_agent_job()` creates a named thread (`clawd-agent-{agent_id}`) that runs the sub-agent. The thread is wrapped in `catch_unwind` for panic safety.

5. **Return immediately**: The tool returns the manifest JSON to the parent conversation. The sub-agent runs asynchronously in the background.

### Sub-agent Runtime Construction

`build_agent_runtime()` creates a full `ConversationRuntime<ProviderRuntimeClient, SubagentToolExecutor>`:

```rust
ConversationRuntime::new(
    Session::new(),                              // Fresh, empty session
    ProviderRuntimeClient::new(model, allowed_tools),  // New API client
    SubagentToolExecutor::new(allowed_tools)     // Restricted tool executor
        .with_enforcer(PermissionEnforcer::new(policy)),
    agent_permission_policy(),                   // Full-access permission policy
    system_prompt,                               // Agent-specific system prompt
)
```

Key details:
- **New Session**: Each sub-agent gets a completely fresh `Session::new()` — no messages, no persistence path. Sub-agent sessions are not persisted to disk as JSONL files.
- **Max iterations**: Capped at `DEFAULT_AGENT_MAX_ITERATIONS = 32`.
- **Default model**: `claude-opus-4-6`.
- **Permission policy**: `agent_permission_policy()` creates a `DangerFullAccess` policy with per-tool requirements from `mvp_tool_specs()`. This means the sub-agent auto-approves all tools (no interactive permission prompts).
- **No permission prompter**: `run_turn(prompt, None)` passes `None` for the prompter, meaning all permissions are evaluated against the policy without user interaction.

### Sub-agent Tool Allowlists

Different sub-agent types get different tool sets:

| Type | Tools | Notes |
|------|-------|-------|
| `Explore` | `read_file`, `glob_search`, `grep_search`, `WebFetch`, `WebSearch`, `ToolSearch`, `Skill`, `StructuredOutput` | Read-only exploration |
| `Plan` | Explore tools + `TodoWrite`, `SendUserMessage` | Planning with todo tracking |
| `Verification` | `bash`, `read_file`, `glob_search`, `grep_search`, `WebFetch`, `WebSearch`, `ToolSearch`, `TodoWrite`, `StructuredOutput`, `SendUserMessage`, `PowerShell` | Can run commands but not edit files |
| `claw-guide` | Explore tools + `SendUserMessage` | User-facing guidance |
| `statusline-setup` | `bash`, `read_file`, `write_file`, `edit_file`, `glob_search`, `grep_search`, `ToolSearch` | Setup-specific tooling |
| Default (any other type) | All standard tools except Agent/Task/Worker/Team/Cron | Full capability minus orchestration |

**Important**: Sub-agents cannot spawn sub-agents — the `Agent`, `Task*`, `Worker*`, `Team*`, and `Cron*` tools are excluded from all sub-agent allowlists.

### Sub-agent API Client

`ProviderRuntimeClient` implements `ApiClient` for sub-agents:
- Holds its own `tokio::runtime::Runtime` for async-over-sync bridging.
- Supports a **fallback provider chain** (`Vec<ProviderEntry>`): if the primary provider returns a retryable error, it falls back to the next provider in the chain.
- Filters tool definitions to only include those in the allowed set.
- Falls back from streaming to non-streaming if the stream returns no events.

### Result Propagation

When the sub-agent's `run_turn()` completes:
1. `final_assistant_text()` extracts the last text content from the `TurnSummary`.
2. `persist_agent_terminal_state()` writes the terminal status to:
   - The output file (appending a terminal section).
   - The manifest file (updating status, `completed_at`, `derived_state`, lane events).
3. Lane events are emitted: `lane.finished` (with optional commit provenance) on success, or `lane.blocked` + `lane.failed` on error.
4. If a commit is detected in the result text, a `lane.commit.created` event is also appended.
5. Matching cron entries may be disabled via `disable_matching_crons()`.

The parent conversation can poll the sub-agent's status by reading the manifest file or using `TaskOutput` if the task was tracked in the registry.

---

## Team & Cron (multi-agent orchestration, scheduled tasks)

### Team Registry

Teams are lightweight groupings of tasks. The `TeamRegistry` provides:

- **`create(name, task_ids)`**: Creates a team with initial task list. Each task in the list is also assigned to the team via `global_task_registry().assign_team()`.
- **`get(team_id)`**: Retrieve a team by ID.
- **`list()`**: List all teams (including soft-deleted ones).
- **`delete(team_id)`**: Soft-delete — sets `status = Deleted` but keeps the record.
- **`remove(team_id)`**: Hard-delete — removes from the `HashMap` entirely.

Team status lifecycle: `Created → Running → Completed` or `→ Deleted`. Status transitions are not enforced by the registry — any status can be set at any time.

**Current state**: Teams are implemented as a metadata layer. There is no built-in orchestration logic that monitors team progress, distributes work, or coordinates between team members. The `TeamCreate` tool creates the grouping and links tasks, but actual orchestration would need to be driven by the parent agent through polling `TaskGet`/`TaskList` and issuing instructions.

### Cron Registry

Cron entries define recurring tasks. The `CronRegistry` provides:

- **`create(schedule, prompt, description)`**: Creates an enabled cron entry with a cron-syntax schedule string.
- **`get(cron_id)`**: Retrieve by ID.
- **`list(enabled_only)`**: List entries, optionally filtering to enabled-only.
- **`delete(cron_id)`**: Hard-delete (removes from HashMap, not soft-delete).
- **`disable(cron_id)`**: Sets `enabled = false` without removing.
- **`record_run(cron_id)`**: Increments `run_count` and updates `last_run_at`.

**Current state**: The cron registry stores schedule metadata but there is **no built-in scheduler** that evaluates cron expressions and triggers executions. The `disable_matching_crons()` function in the agent completion path can auto-disable cron entries when a sub-agent completes successfully, but actual scheduling would need an external driver or a main-loop integration.

The `tools/src/lib.rs` does reference cron entries during agent terminal state handling: when a sub-agent finishes, `disable_matching_crons()` checks if any enabled cron entries match the completed agent's context and disables them, preventing re-execution of already-completed scheduled work.

### Tool Interface

| Tool | Handler | Registry |
|------|---------|----------|
| `TeamCreate` | `run_team_create` | `TeamRegistry.create()` + `TaskRegistry.assign_team()` per task |
| `TeamDelete` | `run_team_delete` | `TeamRegistry.delete()` (soft delete) |
| `CronCreate` | `run_cron_create` | `CronRegistry.create()` |
| `CronDelete` | `run_cron_delete` | `CronRegistry.delete()` (hard delete) |
| `CronList` | `run_cron_list` | `CronRegistry.list(false)` — always returns all entries |

---

## Lane Events (event system for multi-lane coordination)

### Purpose

Lane events provide a structured vocabulary for tracking the lifecycle of concurrent work lanes (sub-agents, workers, parallel tasks). They are the primary coordination mechanism for multi-agent workflows, carrying failure classification, commit provenance, and deduplication metadata.

### Event Categories

**Lifecycle events**: `Started`, `Ready`, `Finished`, `Failed`, `Closed`

**Status events**: `Red` (tests failing), `Green` (tests passing), `Blocked` (waiting on something)

**Delivery events**: `PromptMisdelivery` (prompt landed in wrong place)

**Git events**: `CommitCreated`, `PrOpened`, `MergeReady`, `Merged`, `Reconciled`, `Superseded`

**Branch health events**: `BranchStaleAgainstMain`, `BranchWorkspaceMismatch`

**Ship/provenance events (§4.44.5)**: `ShipPrepared`, `ShipCommitsSelected`, `ShipMerged`, `ShipPushedMain`

### Failure Classification Taxonomy

The 12-variant `LaneFailureClass` enum provides structured failure categorization:

- **Delivery**: `PromptDelivery`, `TrustGate`
- **Source control**: `BranchDivergence`, `WorkspaceMismatch`
- **Build/test**: `Compile`, `Test`
- **Infrastructure**: `PluginStartup`, `McpStartup`, `McpHandshake`, `GatewayRouting`, `ToolRuntime`, `Infra`

### Blocked Subphases

The `BlockedSubphase` enum provides finer-grained classification for `Blocked` events:

| Subphase | Fields | Meaning |
|----------|--------|---------|
| `TrustPrompt` | `gate_repo` | Trust approval needed for a repo |
| `PromptDelivery` | `attempt` | Prompt delivery failed, includes retry count |
| `PluginInit` | `plugin_name` | Plugin initialization stalled |
| `McpHandshake` | `server_name`, `attempt` | MCP server handshake pending |
| `BranchFreshness` | `behind_main` | Branch is N commits behind main |
| `TestHang` | `elapsed_secs`, `test_name` | A test is hanging |
| `ReportPending` | `since_secs` | Report output is pending |

### Metadata and Deduplication

Every `LaneEvent` carries `LaneEventMetadata` with:

- **`seq`**: Monotonic sequence number for ordering.
- **`provenance`**: Source classification (`LiveLane`, `Test`, `Healthcheck`, `Replay`, `Transport`).
- **`session_identity`**: Optional `SessionIdentity` (title, workspace, purpose, placeholder_reason).
- **`ownership`**: Optional `LaneOwnership` (owner, workflow_scope, watcher_action).
- **`nudge_id`**: Deduplication key for reconciliation cycles.
- **`event_fingerprint`**: Hash for terminal event deduplication.
- **`timestamp_ms`**: Wall-clock timestamp.

**Terminal event deduplication**: `dedupe_terminal_events()` uses event fingerprints (16-char hex from `DefaultHasher` of event+status+data) to suppress duplicate terminal events (Finished, Failed, Superseded, Closed, Merged).

**Superseded commit deduplication**: `dedupe_superseded_commit_events()` filters `CommitCreated` events: removes those with `supersededBy` set, and for events sharing a `canonicalCommit` key, keeps only the latest.

### Commit Provenance

`LaneCommitProvenance` tracks commit lineage:
- `commit`: The commit SHA.
- `branch`: Source branch.
- `worktree`: Optional worktree path.
- `canonical_commit`: The canonical/stable commit identity (for deduplication across rebases/amends).
- `superseded_by`: If this commit was superseded by another.
- `lineage`: Ordered list of commit SHAs in the provenance chain.

### Ship Provenance

`ShipProvenance` tracks merge/push operations:
- `source_branch`, `base_commit`, `commit_count`, `commit_range`.
- `merge_method`: `DirectPush`, `FastForward`, `MergeCommit`, `SquashMerge`, `RebaseMerge`.
- `actor`: Who performed the merge.
- `pr_number`: Optional pull request number.

### Where Lane Events Are Consumed

1. **Agent manifests**: `AgentOutput.lane_events` accumulates events. `write_agent_manifest()` deduplicates superseded commits before writing.
2. **Terminal state handling**: `persist_agent_terminal_state()` appends `lane.blocked` + `lane.failed` on error, or `lane.finished` + optional `lane.commit.created` on success.
3. **Lane completion detection**: `lane_completion.rs` uses a `PolicyEngine` to determine if a lane should auto-complete based on events, test status, and code-push status.

---

## Integration Points (reference types from docs 04, 05)

### With ConversationRuntime (doc 04)

- **Sub-agent spawning creates a new `ConversationRuntime`**: `build_agent_runtime()` constructs `ConversationRuntime<ProviderRuntimeClient, SubagentToolExecutor>` — the same generic type as the main CLI, but with different type parameters.
- **Sub-agent gets a fresh `Session::new()`**: No persistence path, no session history. The sub-agent conversation exists only in memory for the lifetime of its thread.
- **`run_turn(prompt, None)`**: Sub-agents call the same `ConversationRuntime::run_turn()` method (doc 04) but without a permission prompter. All tool permissions are auto-approved.
- **Max iterations cap**: `with_max_iterations(32)` prevents runaway sub-agent loops (vs. `usize::MAX` for the main CLI).

### With Tool Execution (doc 05)

- **`SubagentToolExecutor` implements `ToolExecutor`**: The same trait as `CliToolExecutor` (doc 05). It delegates to the same `execute_tool_with_enforcer()` dispatch function, but guards with an allowlist check first.
- **`ProviderRuntimeClient` implements `ApiClient`**: The same trait from doc 04. It bridges async streaming to sync via its own `tokio::runtime::Runtime`.
- **Global singletons shared**: Task, Worker, Team, Cron, LSP, and MCP registries are process-level `OnceLock` singletons. Both the main CLI tools and sub-agent tools access the **same** registry instances. This means a sub-agent could theoretically read/modify task state created by another sub-agent (though the sub-agent tool allowlists prevent this since Task/Worker/Team/Cron tools are excluded from sub-agent allowlists).
- **Tool manifest filtering**: `ProviderRuntimeClient` filters `ToolDefinition` sent to the API to only include allowed tools. `SubagentToolExecutor` also rejects disallowed tools at execution time (defense in depth).

### With Session Management (doc 04)

- Sub-agent sessions are ephemeral — no JSONL persistence, no session forking, no compaction. They live only for the duration of the `run_turn()` call.
- The parent conversation's session is unaffected by sub-agent execution. Results flow back through the agent manifest files on disk.

### With Permission System (doc 04)

- Sub-agents use `agent_permission_policy()` which is `DangerFullAccess` — all tools are auto-approved without user interaction.
- `SubagentToolExecutor` carries its own `PermissionEnforcer` initialized from the same policy, providing a secondary check layer.
- The parent conversation's permission policy/prompter does not propagate to sub-agents.

---

## Open Questions

1. **No sub-agent → parent result channel**: Sub-agent results are written to files on disk (manifest JSON + output Markdown). The parent conversation has no structured mechanism to poll for completion or receive results — it must read the manifest file. There's no callback, channel, or event system connecting the sub-agent thread back to the parent `ConversationRuntime`.

2. **Task registry is disconnected from Agent tool**: The `Agent` tool creates and runs sub-agents but does NOT automatically create a `Task` in the `TaskRegistry`. Similarly, `TaskCreate` creates a task record but does NOT spawn a sub-agent. These are parallel systems. The model must manually coordinate between them (create a task, then spawn an agent, then update the task with results).

3. **Worker system targets external processes, not in-process sub-agents**: The Worker lifecycle (`WorkerRegistry`) is designed for managing external coding-agent processes (tmux panes, terminal processes) via screen-text observation. It does NOT manage the `Agent` tool's in-process sub-agents. These are distinct orchestration layers: Agent = in-process thread, Worker = external process management.

4. **No actual cron scheduler**: The `CronRegistry` stores schedule metadata but nothing evaluates cron expressions or triggers execution on schedule. An external driver (or a future main-loop integration) would be needed for actual scheduling.

5. **Team orchestration is metadata-only**: `TeamCreate` groups tasks and creates a team record, but there's no built-in orchestration logic. No automatic work distribution, progress monitoring, dependency resolution, or parallel execution management. The model must drive orchestration manually.

6. **Sub-agent output is string-only**: `Task.output` is a raw `String` that accumulates via `append_output()`. There's no structured result format. Similarly, `AgentOutput` stores result text in markdown files. Structured data extraction from sub-agent results requires the parent model to parse text.

7. **No sub-agent compaction or context management**: Sub-agents are capped at 32 iterations but have no auto-compaction. If a sub-agent uses large amounts of context within those 32 iterations, there's no mechanism to compress or manage it.

8. **Lane events have no listener/subscriber model**: Lane events are appended to lists (agent manifests, worker event logs) but there's no publish/subscribe mechanism. External observers must poll files on disk. The `emit_state_file()` in worker boot provides file-based observability but it's polling-based, not event-driven.

9. **Worker trust detection is heuristic-based**: Trust prompt detection uses string matching against 5 hardcoded phrases. This could miss trust prompts with different wording or language. Similarly, prompt misdelivery detection uses heuristic screen-text analysis that could produce false positives or negatives.

10. **Race conditions in task output accumulation**: `Task.output` is a `String` protected by `Mutex`, but if multiple threads call `append_output()` concurrently, the ordering of appended content is non-deterministic. The Mutex ensures atomicity but not causal ordering.

---

## Key Files Read

| File | Absolute Path |
|------|---------------|
| task_registry.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/task_registry.rs` |
| task_packet.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/task_packet.rs` |
| worker_boot.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/worker_boot.rs` |
| team_cron_registry.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/team_cron_registry.rs` |
| lane_events.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/lane_events.rs` |
| lib.rs (runtime) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/lib.rs` |
| lib.rs (tools, partial — Agent, Task, Worker, Team, Cron handlers, ProviderRuntimeClient, SubagentToolExecutor, global singletons) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/tools/src/lib.rs` |

### Files NOT read but referenced (for later agents)

- `tools/src/lane_completion.rs` — `PolicyEngine`-based lane auto-completion detection
- `rusty-claude-cli/src/main.rs` — `CliToolExecutor`, `AnthropicRuntimeClient`, `build_runtime()`, full CLI integration
- `runtime/src/conversation.rs` — `ConversationRuntime` core loop (covered in doc 04)
- `runtime/src/policy_engine.rs` — `PolicyEngine`, `PolicyRule`, `PolicyAction` for lane closeout decisions
- `runtime/src/recovery_recipes.rs` — Recovery recipes that may integrate with failure classifications
