---
tags: [pidev, subagent, extensions, debugging]
type: reference
status: in-progress
created: 2026-07-10
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
├── index.ts        # Tool registration, spawn logic, rendering
├── agents.ts       # Agent discovery and config loading
├── tsconfig.json
├── DEBUGGING.md    # Historical bug investigation notes
└── *.test.ts       # Tests
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

## Event Handling & Settlement

The parent reads the child's stdout line-by-line. Important events:

| Event | Action |
|-------|--------|
| `agent_end` | **Settle immediately** — call `resolve(0)`. The process may keep running (extensions keeping event loop alive) but we no longer wait for it. |
| `message_end` | Accumulate messages, update usage stats, call `onUpdate` for streaming UI |
| `tool_result_end` | Accumulate tool result messages |

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

## Known Bug & Fix: Hang with Permission System

> **Date fixed**: 2026-07-10

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

<!-- duplicate heading removed -->
# Current State: `subagentPolicy` Config Field (Implemented 2026-05-31)

The `!ctx.hasUI` auto-allow bypass is now replaced with a configurable 3-branch `subagentPolicy`.

## How It Works Now

When a sub-agent child needs a permission that would normally prompt (`evaluatePermission` returns `"prompt"`):

1. Detection: `!ctx.hasUI || process.env.PI_SUBAGENT === "1"`
2. Read `subagentPolicy` from `~/.pi/agent/permissions.json` (default: `"allow"` for backward compat)
3. Apply policy:

| Policy | Behaviour |
|--------|-----------|
| `"allow"` (default) | Auto-allow — backward compatible with old behaviour |
| `"deny"` | Block with clear error. Agent sees: "Sub-agent denied..." |
| `{ "level": "medium" }` | Re-evaluate bash ops with overridden `bashDefaultLevel`. Ops within level auto-allow; above denies. |

Detection uses both `!ctx.hasUI` and `process.env.PI_SUBAGENT === "1"` — the env var is deliberate from the caller, not a framework side-effect.

## Files Changed

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
  "sensitiveFilePatterns": ["**/.env*", ...]
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

## Phase 5: Interactive Permission Escalation

Filesystem-based child→parent permission request channel. See `extensions/vendored/pi-subagents/PLAN.md`. Large effort.

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
| Storage parse/save | ✅ Done |
| Dist rebuild | ✅ Done 2026-05-31 |
| Per-agent policies (`agentPolicies`) | 🔲 Not started |
| Phase 4: Prompt templates | 🔲 Not started |
| Phase 5: Escalation channel | 🔲 Not started |
| Parent grant propagation | 🔲 Not started |
