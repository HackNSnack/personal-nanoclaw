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

# What the Current Fix Actually Does — and What It Doesn't

To be precise about the scope of the `!ctx.hasUI` auto-allow change:

| Decision from `evaluatePermission` | Parent (interactive) | Sub-agent child (after fix) |
|---|---|---|
| `"allow"` (grant exists / level satisfied) | ✅ Passes through | ✅ Passes through |
| `"deny"` (sensitive file / dangerous command) | ❌ Blocked, no prompt | ❌ Blocked, no prompt |
| `"prompt"` (unknown op, would ask user) | 🔔 Shows UI dialog | ✅ **Auto-allowed — this is the bypass** |

So sub-agents still cannot read `.env` files, SSH keys, or run commands classified above the configured default level. The gap is everything in the **middle tier** — operations that aren't obviously dangerous but that haven't been explicitly permitted yet. In a fresh setup with no grants configured, this middle tier is extremely wide (almost all `bash` invocations, most file reads outside the project tree, etc.).

The fix stops the hang; it does **not** give sub-agents meaningful permission control.

---

# Next Steps: Proper Sub-agent Permission Control

There are three distinct approaches, from simplest to most complete. They can be combined.

---

## Approach 1 — Use the Existing Grant System (No Code Changes)

Grants stored in `~/.pi/agent/permissions.json` and `<project>/.pi/permissions.json` are **file-based**. Every sub-agent child process loads these same files on startup via `loadGlobalPermissions()` and `loadProjectPermissions()`. Grants already flow to sub-agents for free.

This means you can control sub-agent permissions **right now** by pre-configuring the appropriate level or operation grants:

```bash
# In an interactive pi session, allow a medium-level operation
/permissions   # opens the permission manager
# Then: Allow globally → grant stored to ~/.pi/agent/permissions.json
# Sub-agents will respect it automatically on next run
```

Or edit `~/.pi/agent/permissions.json` directly:

```json
{
  "defaultLevel": "medium",
  "globalGrants": [],
  "sensitiveFilePatterns": ["**/.env*", ...]
}
```

Setting `defaultLevel` to `"medium"` will let sub-agents run the vast majority of dev operations without prompting.

**Limitation**: This is coarse — you can't distinguish what the *parent* has already approved interactively from what should or shouldn't be allowed in sub-agents. Anything above `defaultLevel` still hits the auto-allow bypass.

---

## Approach 2 — Sub-agent Policy Config Field (Recommended Next Step)

Add a dedicated `subagentPolicy` field to the global and/or project permissions config. The permissions extension reads it when `!ctx.hasUI` and applies it instead of auto-allowing.

### Config shape to add

**File**: `src/types.ts`

```typescript
export type SubagentPolicy =
  | "allow"          // current behaviour — pass everything through
  | "deny"           // block anything that would have prompted; agent sees a clear error
  | { level: PermissionLevel };  // treat sub-agent as if it has this default level

export interface GlobalPermissions {
  defaultLevel: PermissionLevel;
  subagentPolicy?: SubagentPolicy;   // ← NEW; default: "allow" for backward compat
  globalGrants: Grant[];
  sensitiveFilePatterns: string[];
}
```

Same field can be added to `ProjectPermissions` if project-scoped override is needed.

### Logic change in handlers

**File**: `src/index.ts` — replace the current `!ctx.hasUI` guard in each handler:

```typescript
if (!ctx.hasUI) {
  const globalPerms = loadGlobalPermissions();
  const policy = globalPerms.subagentPolicy ?? "allow";

  if (policy === "allow") {
    return undefined;                       // pass through
  }

  if (policy === "deny") {
    return {
      block: true,
      reason: `Sub-agent permission denied: no interactive session to prompt. ` +
              `Configure a grant or set subagentPolicy to allow this operation.`,
    };
  }

  // policy === { level: PermissionLevel }
  // Re-evaluate as if defaultLevel were policy.level
  const adjustedContext = {
    ...state.context,
    subagentOverrideLevel: policy.level,   // evaluatePermission needs to honour this
  };
  const adjusted = evaluatePermission(operation, adjustedContext);
  if (adjusted.decision === "allow") return undefined;
  return {
    block: true,
    reason: adjusted.reason || `Blocked: operation exceeds sub-agent level (${policy.level})`,
  };
}
```

**File**: `src/evaluation.ts` — make `evaluatePermission` accept an optional override level in `PermissionContext`:

```typescript
// In PermissionContext (types.ts):
export interface PermissionContext {
  projectRoot: string | null;
  currentDir: string;
  onceGrants: Grant[];
  subagentOverrideLevel?: PermissionLevel;  // ← NEW
}

// In evaluatePermission, replace the defaultLevel lookup:
const effectiveLevel = context.subagentOverrideLevel
  ?? projectPerms.projectDefaultLevel
  ?? globalPerms.defaultLevel;
```

### Recommended default config

```json
{
  "defaultLevel": "minimal",
  "subagentPolicy": { "level": "medium" },
  "globalGrants": [],
  "sensitiveFilePatterns": ["**/.env*", ...]
}
```

This lets sub-agents do dev-level operations (npm, git, build, file edits) while the interactive session stays at `minimal` and prompts for anything unusual.

---

## Approach 3 — Signal Sub-agent Context via Environment Variable

Approach 2 requires the permissions extension to decide the policy without knowing *which* sub-agent is running or what the parent approved interactively. An env var set by the subagent extension lets both extensions communicate without touching the pi.dev framework.

### Change in subagent extension

**File**: `agent/extensions/subagent/index.ts` — in the `spawn()` call, add `env`:

```typescript
const proc = spawn(invocation.command, invocation.args, {
  cwd: cwd ?? defaultCwd,
  shell: false,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PI_SUBAGENT: "1",               // signals: I am a sub-agent child
    PI_SUBAGENT_NAME: agentName,    // optional: which agent (for per-agent policy)
  },
});
```

### Change in permissions extension

**File**: `src/index.ts` — the `!ctx.hasUI` check can then also look at the env var as a secondary signal:

```typescript
const isSubagent = !ctx.hasUI || process.env.PI_SUBAGENT === "1";
if (isSubagent) { /* policy logic */ }
```

Using the env var rather than (or alongside) `ctx.hasUI` is more explicit and easier to understand when reading the code — `!ctx.hasUI` is a framework implementation detail, `PI_SUBAGENT` is a deliberate signal from the caller.

**Bonus**: The env var also enables per-agent policy if you include `PI_SUBAGENT_NAME` — you could store agent-specific overrides in the permissions config:

```json
{
  "subagentPolicy": { "level": "medium" },
  "agentPolicies": {
    "code-reviewer": "allow",
    "file-cleaner": "deny"
  }
}
```

---

## Approach 4 — Propagate Parent's In-Memory Grants to Child (Advanced)

Grants accepted during the current interactive session as "Allow once" live only in `state.context.onceGrants` (in-memory, not persisted). They disappear when the parent session ends and are never seen by sub-agents. This approach propagates them.

### How

**In subagent extension** (`index.ts`) — before spawning, serialise the parent's context grants to a temp file and pass the path via env var:

```typescript
// The subagent tool's execute() receives ctx which has access to...
// Unfortunately ctx doesn't expose the permissions extension's state directly.
// This requires either:
//   (a) the permissions extension to expose its grants via a shared temp file it writes on each change
//   (b) a new pi.dev mechanism for extensions to share data (not currently available)
```

This approach is the most architecturally complex because the two extensions don't share memory (they're separate module instances). The cleanest path is:

1. Permissions extension writes its current `onceGrants` to a known temp file (e.g. `~/.pi/cache/session-grants-<pid>.json`) on every grant addition
2. Subagent extension reads that file and passes the path as `PI_SUBAGENT_GRANTS_FILE=<path>` to the child env
3. Child's permissions extension reads the file on startup and loads the grants into its initial `onceGrants`

This is not worth implementing until Approaches 2 and 3 are in place, since those already cover the common case.

---

## Code Locations Summary

| What to change | File | Notes |
|---|---|---|
| Add `SubagentPolicy` type | `permissions/src/types.ts` | Also extend `GlobalPermissions` and optionally `ProjectPermissions` |
| Load & apply policy | `permissions/src/index.ts` | Replace `!ctx.hasUI` guard in all 4 handlers |
| Override level during eval | `permissions/src/evaluation.ts` | Accept `subagentOverrideLevel` from context |
| Pass override level through context | `permissions/src/types.ts` | Add optional field to `PermissionContext` |
| Set `PI_SUBAGENT` env var | `subagent/index.ts` | In the `spawn()` call options object |
| Update `/permissions show` output | `permissions/src/index.ts` | In `handlePermissionsCommand` — display `subagentPolicy` value |
| Persist new fields | `permissions/src/storage.ts` | If adding new JSON fields, ensure `loadGlobalPermissions` provides defaults |

---

## Recommended Implementation Order

1. **Right now (no code)**: Set `defaultLevel: "medium"` in `~/.pi/agent/permissions.json`. Sub-agents can then do most dev work without hitting the auto-allow bypass at all.
2. **Short term**: Add `PI_SUBAGENT=1` env var to the `spawn()` call in `subagent/index.ts`. Rebuild. Use this as the detection signal in permissions instead of `!ctx.hasUI` — clearer intent.
3. **Medium term**: Add `subagentPolicy` to `GlobalPermissions`, load it in the `!ctx.hasUI` / `PI_SUBAGENT` branch, expose it in `/permissions show`.
4. **Later if needed**: Per-agent policies keyed by `PI_SUBAGENT_NAME`, and/or parent grant propagation.
