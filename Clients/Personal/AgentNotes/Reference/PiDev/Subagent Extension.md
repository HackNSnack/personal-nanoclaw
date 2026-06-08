---
tags:
  - pidev
  - subagent
  - extensions
  - debugging
type: reference
status: active
created: 2026-07-10T00:00:00.000Z
---

# Subagent Extension

Custom pi.dev extension that lets the main agent delegate self-contained tasks to specialised sub-agents, each running in an **isolated context window**. Lives at `~/.pi/agent/extensions/subagent/`.

## How It Works

The extension registers a single tool called `subagent`. When the LLM calls it, the extension spawns a **separate `pi` child process** via Node `spawn()`, waits for it to complete, and feeds the result back to the parent conversation.

Because the child is a brand-new `pi` process it gets:
- Its own fresh context window (no token bleed-through from the parent)
- Its own copy of all loaded extensions (including `permissions`)
- Its own working directory

```
[Parent pi session]  ──calls──▶  subagent tool
                                      │
                                 spawn child pi
                                 --mode json -p --no-session
                                 stdio: [ignore, pipe, pipe]
                                      │
                              [Child pi session]
                              loads all extensions
                              runs agent loop
                              emits JSON events → stdout
                                      │
                     parent reads stdout, settles on agent_end
```

## File Structure

```
~/.pi/agent/extensions/subagent/
├── index.ts             # Tool registration, spawn logic, rendering
├── agents.ts            # Agent discovery and config loading
├── permission-bridge.ts # Shared types & constants for escalation channel (Phase 5)
├── tsconfig.json
├── DEBUGGING.md         # Historical bug investigation notes
└── *.test.ts            # Tests
```

## Modes

The tool supports three invocation modes, selected by which parameters are provided:

| Mode | Params | Behaviour |
|------|--------|-----------|
| **Single** | `agent` + `task` | Runs one agent, returns its final output |
| **Parallel** | `tasks[]` | Runs up to 8 agents concurrently (max 4 at once), returns all results |
| **Chain** | `chain[]` | Runs agents sequentially; each step can reference the previous output via `{previous}` |

## Agent Discovery

Agents are markdown files in one of two directories:

| Scope | Directory | Param value |
|-------|-----------|-------------|
| User (default) | `~/.pi/agent/agents/` | `agentScope: "user"` |
| Project | `.pi/agents/` (nearest ancestor) | `agentScope: "project"` |
| Both | both dirs, project overrides on name clash | `agentScope: "both"` |

### Agent Definition Format

```markdown
---
name: my-agent
description: Does X given Y
tools: bash,read,write
model: claude-sonnet-4-5
thinking: high
systemPromptMode: replace
inheritProjectContext: true
inheritSkills: false
output: plan.md
defaultReads: context.md
defaultProgress: true
---

You are a specialist in...
(rest of file is the system prompt)
```

**Frontmatter fields:**

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | ✅ | — | Agent identifier |
| `description` | ✅ | — | One-line description |
| `tools` | | all tools | Comma-separated tool allowlist (subagent always stripped) |
| `extensions` | | all extensions | Comma-separated extension paths; when set, child uses `--no-extensions --extension <path>` |
| `model` | | parent's model | Model ID |
| `thinking` | | off | Thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `systemPromptMode` | | `append` | `append` adds to base prompt; `replace` replaces it entirely |
| `inheritProjectContext` | | `true` | Whether child loads AGENTS.md/CLAUDE.md (`--no-context-files` when false) |
| `inheritSkills` | | `true` | Whether child loads skills (`--no-skills` when false) |
| `output` | | — | File the agent is expected to write results to (informational) |
| `defaultReads` | | — | Comma-separated files to read before starting (prepended to task) |
| `defaultProgress` | | `false` | Whether agent reports progress updates (parsed, reserved for future use) |
| `defaultContext` | | `fresh` | `fresh` starts clean; `fork` inherits parent session via `--fork` |

`tools` is optional. If omitted the agent inherits the default tool set but is **prevented from using `subagent`** itself (anti-recursion, enforced by prepending `NO_SUBAGENT_INSTRUCTION` to the system prompt).

## Child Process Invocation

The child is launched with flags determined by the agent's frontmatter:

```
pi --mode json -p --no-session \
  [--model <model>[:<thinking>]] \
  [--thinking <level>] \
  [--tools <list>] \
  [--system-prompt <tmpfile> | --append-system-prompt <tmpfile>] \
  [--no-context-files] \
  [--no-skills] \
  [--no-extensions [--extension <path>]...] \
  "Task: <task text>"
```

Key flags:
- `--mode json` — child emits newline-delimited JSON events on stdout
- `-p` — print/non-interactive mode
- `--no-session` — no session persistence
- `--model model:thinking` — thinking level appended as suffix when agent defines both `model` and `thinking`
- `--thinking level` — standalone thinking flag when agent defines `thinking` but no `model`
- `--system-prompt` — used when `systemPromptMode: replace` (replaces default coding assistant prompt)
- `--append-system-prompt` — used when `systemPromptMode: append` (default, adds to base prompt)
- `--no-context-files` — when `inheritProjectContext: false`
- `--no-skills` — when `inheritSkills: false`
- `defaultReads` — prepended to the task text as `[Read these files first if they exist: ...]`
- `stdio: ["ignore", "pipe", "pipe"]` — **stdin is /dev/null**, stdout/stderr are captured

**Environment variables passed to every child:**

| Variable | Value | Purpose |
|----------|-------|--------|
| `PI_SUBAGENT` | `"1"` | Signals to extensions they're in a subagent subprocess |
| `PI_SUBAGENT_CHILD` | `"1"` | Same (legacy name kept for compat) |
| `PI_SUBAGENT_CHILD_AGENT` | agent name | Agent identity (used in escalation prompts and per-agent policies) |
| `PI_SUBAGENT_PERMS_DIR` | temp dir path | **Phase 5:** response drop directory for permission escalation channel |

## Event Handling & Settlement

The parent reads the child's stdout line-by-line. Important events:

| Event | Action |
|-------|--------|
| `agent_end` | **Settle immediately** — call `resolve(0)`. The process may keep running (extensions keeping event loop alive) but we no longer wait for it. |
| `message_end` | Accumulate messages, update usage stats, call `onUpdate` for streaming UI |
| `tool_result_end` | Accumulate tool result messages |
| `tool_execution_start` | Record active tool for live progress display |
| `tool_execution_end` | Clear active tool; track file mutations (write/edit) |
| `permission_request` | **Phase 5:** child is paused waiting for permission. Trigger escalation prompt in parent TUI. |

After settling, the parent sends SIGTERM to the child, then SIGKILL after 3 s (timer is `.unref()`-ed so it doesn't block the parent's own exit).

> **Why settle on `agent_end` not `close`?** Pi extensions (MCP sockets, file watchers, etc.) keep the Node/Bun event loop alive even after the agent finishes. The process never calls `process.exit()`. Without the early settle the parent would wait forever. See `DEBUGGING.md` for the full investigation.

## Key Implementation Details

### `getPiInvocation()`

Determines how to re-invoke pi depending on the runtime:

```
isBunVirtualScript (/$bunfs/root/…)  →  use execPath directly with args (no script arg)
currentScript exists on disk         →  node/bun <script> <args>
execName is generic runtime (node/bun) →  pi <args>   (fall back to PATH)
otherwise                            →  execPath <args>  (compiled binary like pi-linux)
```

### Anti-Recursion

To prevent subagents from calling `subagent` recursively:
1. If the agent definition lists explicit `tools`, `"subagent"` is stripped from that list in `agents.ts`
2. If the agent has no explicit tools list, `NO_SUBAGENT_INSTRUCTION` is prepended to the system prompt

### Concurrency

Parallel mode uses `mapWithConcurrencyLimit(tasks, 4, ...)` — at most 4 child processes run simultaneously regardless of how many tasks are requested (max 8 tasks total).

Permission escalation prompts across concurrent parallel agents are serialised through a module-level `_permPromptQueue` so only one dialog is shown at a time. Children waiting for permission display `🔒 Waiting for permission…` in the TUI.

### Available Agents

User agents in `~/.pi/agent/agents/`:

| Agent | Thinking | Key Features | Use Case |
|-------|----------|--------------|----------|
| `scout` | low | Fast recon, writes `context.md` | First step in chains — map the codebase |
| `context-builder` | medium | Deep analysis + meta-prompt, writes `context.md` | When scout isn't thorough enough |
| `planner` | high | Reads `context.md`, writes `plan.md` | Turn requirements into actionable steps |
| `worker` | high | Reads `context.md` + `plan.md`, full edit tools, `fork` context | Execute implementation plans |
| `reviewer` | high | Reads `plan.md`, code review specialist | Validate diffs, plans, codebase health |
| `oracle` | high | Read-only, decision consistency, `fork` context | Catch drift, validate direction |
| `researcher` | medium | Web search, writes `research.md` | External API docs, best practices |
| `delegate` | (parent) | Lightweight, `systemPromptMode: append` | Quick one-off tasks |
| `ext-builder` | (none) | Pi extension specialist | Building/modifying pi extensions |

Typical chain patterns:
- `scout → planner → worker` — standard implementation flow
- `context-builder → planner → worker → reviewer` — thorough implementation with review
- `researcher → worker` — research-driven implementation
- `oracle` (single) — decision validation checkpoint

### Project Agent Confirmation

When `agentScope` includes project agents and `confirmProjectAgents: true` (default), the tool calls `ctx.ui.confirm()` before running any project-sourced agent. This is a safety gate since project agents are repo-controlled and could be malicious.

---

## Phase 5: Interactive Permission Escalation (Implemented 2026-07-10)

Sub-agents running with `subagentPolicy: "deny"` or `{ level }` can now pause on ungranted operations and escalate a permission request to the parent session's interactive TUI — exactly as if the main agent had triggered it.

### UX

```
Parent TUI shows:

  [worker] Run command: npm install express
  Classification: Medium
  No matching permission grant

  1. Allow once
  2. Allow for this project
  3. Allow globally
  4. Cancel
```

While waiting, the subagent progress view shows: `🔒 Waiting for permission…`

If the user selects **Allow for this project** or **Allow globally**, a subject-scope dialog follows (same as the main session). The grant is saved to `permissions.json` immediately — the next time the same child (or any other child) hits the same operation, it is auto-allowed without re-prompting.

### Protocol (Hybrid stdout + filesystem)

```
Child hits ungranted operation (PI_SUBAGENT=1, policy != "allow")
  └─ PI_SUBAGENT_PERMS_DIR is set → requestParentPermission()
       └─ writes to process.stdout:
          {"type":"permission_request","requestId":"abc","agent":"worker",
           "operation":{"type":"bash","details":"npm install express"},
           "reason":"No matching permission grant"}
       └─ polls /tmp/pi-perms-XYZ/res_abc.json every 150ms, up to 60s

Parent's processLine reads NDJSON line
  └─ event.type === "permission_request"
       └─ currentResult.waitingForPermission = true
       └─ _permPromptQueue serialises (only one dialog at a time)
            └─ pi.events.emit("permissions:escalate-subagent", {..., markHandled})
                 └─ permissions extension handler:
                      markHandled() synchronously ← subagent detects registration
                      promptForPermission(op, ctx, reason, "[worker] ")
                      saves grant if project/global scope
                      writes {decision:"allow"} → /tmp/pi-perms-XYZ/res_abc.json

Child poll succeeds → returns undefined (allow) or { block: true, reason }
Grant is on disk → next call auto-allows
```

### Fallback Chain

| Condition | Behaviour |
|-----------|----------|
| `subagentPolicy: "allow"` | Auto-allow (escalation never triggered) |
| `PI_SUBAGENT_PERMS_DIR` set, permissions ext registered | Full interactive escalation |
| `PI_SUBAGENT_PERMS_DIR` set, permissions ext NOT loaded | Parent falls back to `ctx.ui.confirm()` basic yes/no |
| Parent has no UI (`!ctx.hasUI`) | Write deny immediately — child doesn't hang |
| 60s timeout without response | Fall through to static `subagentPolicy` (deny/level) |

### Files Changed

| File | What changed |
|------|--------------|
| `subagent/permission-bridge.ts` | **New.** Shared protocol types (`PermissionRequestEvent`, `PermissionResponseFile`), constants (`PERM_REQUEST_EVENT_TYPE`, `PERMS_DIR_ENV_VAR`, `PERMS_ESCALATE_EVENT`, `PERMS_TIMEOUT_MS=60_000`, `PERMS_POLL_INTERVAL_MS=150`), `getResponsePath()` |
| `subagent/index.ts` | `writePermResponse()` helper; `_permPromptQueue` module-level serialiser; `let permsDir` + `mkdtemp("pi-perms-")` creation; `PI_SUBAGENT_PERMS_DIR` in spawn env; `permission_request` handler in `processLine`; `permsDir` cleanup in `finally` (5s grace); `waitingForPermission` field + TUI indicator; `pi` + `ctx` params on `runSingleAgent` |
| `permissions/src/prompts.ts` | Optional `agentLabel?: string` on `promptForPermission` — prepended to message (e.g. `"[worker] Run command: …"`) |
| `permissions/src/index.ts` | `import * as fs/path`; `requestParentPermission()` (child side: writes NDJSON, polls); escalation path in `handleToolCallGeneric` subagent block; `permissions:escalate-subagent` event handler (parent side: `markHandled`, full prompt, grant save, response write) |
| `permissions/dist/` | Rebuilt 2026-07-10 |

### Design Notes

**Why stdout for the request, filesystem for the response?**  
The parent already parses all child stdout as NDJSON. Adding a `permission_request` event type is zero extra IPC. The child can't receive responses via stdin (it's `/dev/null`), so a temp file is the simplest reliable channel.

**Why `markHandled()`?**  
`pi.events.emit()` calls handlers synchronously. By having the permissions extension call `payload.markHandled?.()` at the start of its async handler, the subagent extension can distinguish "permissions ext is registered and handling this" from "no handler registered" — in the latter case it falls back to a basic `ctx.ui.confirm()` immediately instead of waiting the full 60s.

**Why a module-level serialiser?**  
In parallel mode, multiple children can hit permission walls simultaneously. Two concurrent `ctx.ui.select()` calls have undefined behaviour in pi's TUI. The `_permPromptQueue` ensures at most one permission dialog is open at a time. Children keep polling (they don't know about the queue) and will get their response as soon as the previous prompt resolves.

**Grant persistence loop:**  
When the user picks "Allow for this project" and the grant is written to `.pi/permissions.json`, the permissions extension's file watcher invalidates its cache. The next call from any agent (child or main) picks up the grant via the normal `evaluatePermission` path and auto-allows without escalation.

---

## Known Bug & Fix: Hang with Permission System

> **Date fixed**: 2026-07-10  
> **Superseded by**: Phase 5 + `subagentPolicy` (2026-05-31)

### Symptom

When the `permissions` extension is active and a subagent tries to run a `bash`/`read`/`write`/`edit` operation that has no pre-configured permission, **the parent session hangs indefinitely** — the "Working…" spinner never clears.

### Root Cause

The permissions extension was written for **interactive mode only**. In a subagent child process:
- `--mode json` → `ctx.hasUI === false`
- `ctx.ui` is the `noOpUIContext` — `select()` returns `undefined` immediately, `onTerminalInput()` never fires

Full call chain when permission is needed:

```
child: tool_call event fires
  → handleBashToolCall()
  → evaluatePermission() returns "prompt"
  → promptForPermission()
    → customSelectPrompt()
      → Promise.race([
          ctx.ui.select()   // noOp → resolves undefined immediately
          onTerminalInput() // noOp → never resolves
        ])
      → race resolves { type: "cancelled" }
    → returns { choice: "cancel" }
  → ctx.abort()   ← ⚠️  THIS IS THE BUG
  → return { block: true }
```

`ctx.abort()` → `agentSession.abort()` → `agent.abort()` → `abortController.abort()`.

The tool call is blocked **and** the agent run's AbortController is signalled. The agent loop then immediately proceeds to the next turn and calls `streamAssistantResponse()` with the already-aborted signal.

Whether that HTTP request cancels immediately depends on Bun's `fetch` + Anthropic SDK abort-signal handling at exactly that moment. In the Anthropic provider, the abort is only checked **at the end of the streaming loop** (`if (options?.signal?.aborted) throw …`), meaning the child may wait for a **complete LLM round-trip** before detecting the abort. This round-trip (several seconds) is what the user perceives as a hang. In some timing scenarios it can be much longer or block until a network timeout.

### Fix

Added a `!ctx.hasUI` guard in **all four handlers** (`handleBashToolCall`, `handleReadToolCall`, `handleWriteToolCall`, `handleEditToolCall`), placed after the hard `"deny"` check but before `promptForPermission`:

```typescript
// In non-interactive mode (e.g. subagent subprocess), we cannot show a prompt.
// Auto-allow: the user implicitly trusted this session by invoking it.
// Calling ctx.abort() here would cause the agent to abort mid-beforeToolCall,
// leaving a dangling LLM HTTP request that may not cancel immediately — this
// is the root cause of the "system hangs" symptom when permissions and
// subagents are used together.
if (!ctx.hasUI) {
    return undefined;   // allow
}
```

**Why auto-allow (not auto-deny)?**

- Auto-deny would also fix the hang (no `ctx.abort()` call), but would make subagents unable to perform any operation lacking a pre-configured permission — defeating their purpose
- Hard `"deny"` decisions from `evaluatePermission` (sensitive files, commands above the configured level) still fire unconditionally in both modes — the security floor is unchanged
- The user has already implicitly trusted the subagent by invoking it

**File changed**: `~/.pi/agent/extensions/permissions/src/index.ts`  
**Rebuild required**: `cd ~/.pi/agent/extensions/permissions && pnpm run build`

### Where `ctx.hasUI` Comes From

In `pi-mono/packages/coding-agent/src/core/extensions/runner.ts`:

```typescript
const noOpUIContext: ExtensionUIContext = {
    select: async () => undefined,
    confirm: async () => false,
    notify: () => {},
    onTerminalInput: () => () => {},
    // ...
};

hasUI(): boolean {
    return this.uiContext !== noOpUIContext;
}
```

In **JSON / print mode** (`runPrintMode`), `setUIContext()` is never called, so the runner keeps `noOpUIContext` and `hasUI()` returns `false`. In **interactive mode**, `InteractiveMode` calls `setUIContext(realUIContext)`, making `hasUI()` return `true`.

The `ExtensionContext` passed to every handler always contains `hasUI: this.hasUI()` — so extensions can safely branch on it.

---

## Previous Bug: Premature Settlement / Process Not Exiting

> **Date fixed**: 2026-04-23 — documented in `DEBUGGING.md`

### Symptom

Parent session showed ✓ (success) while the subagent was still running, then got permanently stuck on "Working…".

### Cause

1. `currentResult.exitCode` was initialised to `0` instead of `-1`, so any intermediate `onUpdate` call rendered a false success tick
2. The child process emitted `agent_end` but **never exited** — extensions (MCP sockets, timers) kept the Bun event loop alive. `proc.on("close")` therefore never fired, and the `Promise` in `runSingleAgent` never resolved

### Fix

- Initialise `currentResult.exitCode = -1` ("still running" sentinel, matching parallel mode)
- Settle the promise on `agent_end` rather than `close`:
  ```typescript
  if (event.type === "agent_end") {
      settle(0);
  }
  ```
- After settling, send SIGTERM to the child (it can finish cleanup asynchronously)

---

## Related

- [[Clients/Personal/AgentNotes/Reference/PiDev/Permission System]] — the extension that interacts with subagents
- [[Clients/Personal/AgentNotes/Reference/PiDev/Overview]] — pi.dev architecture overview
- [[Clients/Personal/AgentNotes/Reference/PiDev/Configuration]] — where agent definitions live

---

# Current State: `subagentPolicy` Config Field (Implemented 2026-05-31)

The `!ctx.hasUI` auto-allow bypass is now replaced with a configurable 3-branch `subagentPolicy`.

## How It Works Now

When a sub-agent child needs a permission that would normally prompt (`evaluatePermission` returns `"prompt"`):

1. Detection: `!ctx.hasUI || process.env.PI_SUBAGENT === "1"`
2. If `PI_SUBAGENT_PERMS_DIR` is set → **escalate to parent TUI** (Phase 5 — see above)
3. Otherwise, read `subagentPolicy` from `~/.pi/agent/permissions.json` (default: `"allow"` for backward compat)
4. Apply policy:

| Policy | Behaviour |
|--------|-----------|
| `"allow"` (default) | Auto-allow — backward compatible with old behaviour |
| `"deny"` | Block with clear error. Agent sees: "Sub-agent denied..." |
| `{ "level": "medium" }` | Re-evaluate bash ops with overridden `bashDefaultLevel`. Ops within level auto-allow; above denies. |

Detection uses both `!ctx.hasUI` and `process.env.PI_SUBAGENT === "1"` — the env var is deliberate from the caller, not a framework side-effect.

## Files Changed (2026-05-31)

| File | Change |
|------|--------|
| `permissions/src/types.ts` | Added `SubagentPolicy` type, `subagentPolicy` on `GlobalPermissions`, `subagentOverrideLevel` on `PermissionContext` |
| `permissions/src/storage.ts` | `loadGlobalPermissionsSync()` parses `subagentPolicy`; `getDefaultGlobalPermissions()` includes it (undefined → "allow") |
| `permissions/src/evaluation.ts` | Step 6 uses `context.subagentOverrideLevel ?? globalPerms.bashDefaultLevel` |
| `permissions/src/index.ts` | Replaced `!ctx.hasUI` guard with 3-branch policy. `/permissions show` displays current value |
| `subagent/index.ts` | Added `PI_SUBAGENT=1` to child spawn env |

## Example Config

```json
{
  "bashDefaultLevel": "minimal",
  "subagentPolicy": { "level": "medium" },
  "globalGrants": [],
  "sensitiveFilePatterns": ["**/.env*", "..."]
}
```

Interactive session stays at `minimal` (prompts for unusual ops). Sub-agents operate at `medium` (dev ops: npm, git, build, file edits).

---

# Remaining Work

## Per-Agent Policies

Extend `subagentPolicy` with agent-specific overrides keyed by `PI_SUBAGENT_CHILD_AGENT`:

```json
{
  "subagentPolicy": { "level": "medium" },
  "agentPolicies": {
    "reviewer": "allow",
    "file-cleaner": "deny"
  }
}
```

Env var already set — needs config field + lookup logic.

## Phase 4: Prompt Templates

Slash commands (`/parallel-review`, `/review-loop`) adopting prompts from official `pi-subagents`. Medium effort.

## Parent Grant Propagation

Serialise parent's `onceGrants` to temp file for child inheritance. Wait for per-agent policies first.

---

## Implementation Status

| What | Status |
|------|--------|
| `PI_SUBAGENT=1` env var in spawn | ✅ Done |
| `SubagentPolicy` type | ✅ Done |
| `subagentPolicy` on `GlobalPermissions` | ✅ Done |
| `subagentOverrideLevel` on `PermissionContext` | ✅ Done |
| 3-branch handler logic (allow/deny/level) | ✅ Done |
| `/permissions show` display | ✅ Done |
| Storage parse/save | ✅ Done 2026-05-31 |
| Phase 5: `permission-bridge.ts` | ✅ Done 2026-07-10 |
| Phase 5: child `requestParentPermission()` | ✅ Done 2026-07-10 |
| Phase 5: escalation path in `handleToolCallGeneric` | ✅ Done 2026-07-10 |
| Phase 5: parent `permissions:escalate-subagent` handler | ✅ Done 2026-07-10 |
| Phase 5: `agentLabel` param on `promptForPermission` | ✅ Done 2026-07-10 |
| Phase 5: `PI_SUBAGENT_PERMS_DIR` in spawn env | ✅ Done 2026-07-10 |
| Phase 5: `permission_request` handler in `processLine` | ✅ Done 2026-07-10 |
| Phase 5: `_permPromptQueue` serialiser | ✅ Done 2026-07-10 |
| Phase 5: `🔒 Waiting for permission…` TUI indicator | ✅ Done 2026-07-10 |
| Phase 5: `permsDir` cleanup in `finally` | ✅ Done 2026-07-10 |
| Phase 5: `dist/` rebuild | ✅ Done 2026-07-10 |
| Per-agent policies (`agentPolicies`) | 🔲 Not started |
| Phase 4: Prompt templates | 🔲 Not started |
| Parent grant propagation | 🔲 Not started |
| MCP tool propagation to children | ✅ Done 2026-07-14 |

---

## Bug & Fix: MCP Tools Inaccessible in Subagent Children (Fixed 2026-07-14)

### Symptom

Subagents had no access to MCP tools — the LLM in the child process could not see or call `mcp`, `obsidian_read_note`, `atlassian_*`, or any other MCP-registered tool, even though the MCP adapter extension loads correctly in the child.

### Root Causes

Two causes act together:

**Cause 1 — `--tools` is an exclusive allowlist that filters extension tools too**

When an agent definition has a `tools:` frontmatter field, the subagent extension passes `--tools <list>` to the child `pi` process. Per `pi --help`:

```
--tools, -t <tools>   Comma-separated allowlist of tool names to enable
                      Applies to built-in, extension, and custom tools
```

This is a hard filter that covers *all* tool categories. The MCP adapter extension still loads and registers its tools in the child — they are just invisible to the LLM unless the tool name appears in `--tools`. Since every agent except `ext-builder` omitted `mcp` from its `tools:` list, no child LLM could call any MCP tool.

**Cause 2 — Direct MCP tool names are dynamic and cannot be listed in agent frontmatter**

The MCP adapter registers two kinds of tools in the parent session:
- `mcp` — the proxy gateway (fixed name, always the same)
- Direct tools: `obsidian_read_note`, `atlassian_create_issue`, etc. — names computed at load time from `~/.config/mcp/mcp.json` + the on-disk metadata cache

Even for `ext-builder` (which *did* have `mcp` in its tools list), passing `--tools ...,mcp` only exposed the proxy. The direct tools were still blocked because their names aren't statically knowable when writing agent frontmatter — they depend on which MCP servers are configured.

**Combined effect:**

```
agent frontmatter: tools: bash,read,write   ← no 'mcp'
      ↓
runSingleAgent() builds: --tools bash,read,write
      ↓
child pi spawns → MCP adapter loads → registers 'mcp' + 'obsidian_read_note' + 'atlassian_*'
      ↓
--tools filter: only bash, read, write visible to LLM
      ↓
LLM has no knowledge of any MCP tool
```

Even with `mcp` in the tools list:

```
--tools ...,mcp
  → 'mcp' proxy  ✅ visible
  → 'obsidian_read_note'  ✗ still blocked (name not in --tools)
  → 'atlassian_*'         ✗ still blocked
```

### Fix

**Code change — `subagent/index.ts`**

Two module-level constants were added:

```typescript
// Pi's seven built-in tool names (from `pi --help`)
const BUILTIN_TOOL_NAMES = new Set([
    'bash', 'read', 'write', 'edit', 'grep', 'find', 'ls',
]);

// Well-known extension tools that are NOT MCP direct tools.
// Everything in getAllTools() that is not a builtin and not in this set
// is treated as a MCP direct tool and propagated to the child.
const NON_MCP_EXTENSION_TOOL_NAMES = new Set([
    'subagent',
    'mcp',                                              // the proxy itself
    'web_search', 'code_search',                        // pi-web-access
    'fetch_content', 'get_search_content',
    'ast_grep_search', 'ast_grep_replace', 'ast_dump',  // pi-lens
    'lens_diagnostics', 'lsp_diagnostics', 'lsp_navigation',
]);
```

The `--tools` argument construction was changed: when an agent's `tools:` list contains `'mcp'`, the spawn logic calls `pi.getAllTools()` on the parent session, subtracts `BUILTIN_TOOL_NAMES` and `NON_MCP_EXTENSION_TOOL_NAMES`, and appends whatever remains (the direct MCP tool names) to the child's `--tools` argument automatically — no manual enumeration needed.

This is **opt-in**: the propagation only fires when `'mcp'` is explicitly in the agent's `tools:` list. Agents without `mcp` are completely unaffected.

**Agent definitions updated**

| Agent | Change |
|-------|--------|
| `worker.md` | Added `mcp` to `tools:` |
| `delegate.md` | Added `mcp` to `tools:` |
| `ext-builder.md` | Already had `mcp` ✅ |

Other agents (`scout`, `planner`, `reviewer`, `oracle`, `researcher`, etc.) were intentionally left without `mcp` — add it only if those agents need Obsidian / Atlassian access.

---

### ⚠️ Maintenance: What Must Change If the MCP Proxy Is Replaced

The fix has **two hardcoded coupling points** to the string `'mcp'`. Both must be updated together if the proxy tool is renamed or replaced.

#### Coupling point 1 — The opt-in sentinel (`index.ts`, in `runSingleAgent`)

```typescript
if (effectiveTools.includes('mcp')) {   // ← hardcoded proxy tool name
```

This is the trigger: an agent signals MCP intent by listing this exact name in its `tools:` frontmatter. If the new proxy is called something else (e.g. `tools`, `gateway`, `mcp2`), this string literal must change to match.

> **If you remove the proxy entirely** and all MCP access is via direct tools only: delete this `if` block and instead always run the propagation logic unconditionally. You still need `NON_MCP_EXTENSION_TOOL_NAMES` to be current so direct tools are correctly identified.

#### Coupling point 2 — `NON_MCP_EXTENSION_TOOL_NAMES` set (`index.ts`, module level)

This set is the exclusion list: "anything that is NOT a builtin AND NOT in this set = a direct MCP tool". The proxy's own name lives here to prevent it from being misidentified as a direct tool and double-added to `--tools`.

Required changes when replacing the proxy:

| Scenario | Change to `NON_MCP_EXTENSION_TOOL_NAMES` |
|----------|------------------------------------------|
| Proxy renamed `mcp` → `X` | Remove `'mcp'`, add `'X'` |
| Proxy removed entirely | Remove `'mcp'` |
| New proxy added alongside existing `mcp` | Add the new name; keep `'mcp'` |
| New non-MCP extension registers tools `Y`, `Z` | Add `'Y'`, `'Z'` — otherwise they'll be misidentified as direct MCP tools and incorrectly propagated to children |

#### Coupling point 3 — Agent `tools:` frontmatter

Every agent definition with `mcp` in its `tools:` field relies on the sentinel check above. If the proxy name changes, update each agent file:

- **Files to audit:** `~/.pi/agent/agents/*.md` and any `.pi/agents/*.md` in project repos
- **Currently affected:** `worker`, `delegate`, `ext-builder`

#### What does NOT need to change

- The child process side is untouched: direct tools are registered from the MCP metadata cache identically in both parent and child. The fix only controls what names get appended to `--tools` in the parent before spawning.
- Adding or removing MCP servers in `~/.config/mcp/mcp.json` is **self-updating**: the changed direct tool names appear automatically in `pi.getAllTools()` next session — no code edits needed.

#### If `pi.getAllTools()` is removed in a future pi API change

The fix calls `pi.getAllTools()` inside the `execute` callback via the parent's `pi: ExtensionAPI` closure. If that API is ever removed, the fallback is to read the MCP adapter's on-disk metadata cache directly. Check `metadata-cache.ts` in the MCP adapter source for the exact file path. This is fragile — `getAllTools()` is the right API, avoid the fallback if possible.
