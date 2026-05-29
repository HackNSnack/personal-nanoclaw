# 01 — Monorepo Structure & Bootstrap

## Summary

Pi is a TypeScript monorepo (`pi-mono`) with 7 packages, built on Bun. The CLI entry point is `coding-agent/src/main.ts` which parses arguments, resolves sessions and models, creates an `AgentSessionRuntime`, and dispatches to one of four app modes (interactive, print, JSON, RPC). The bootstrap sequence is entirely linear — config, settings, auth, extensions, tools, model, session, then mode — with no phase-gate or parallel initialization.

## Key Types & Interfaces

### CLI Layer (`coding-agent/src/main.ts`, `cli/args.ts`)

| Type | Description |
|---|---|
| `Args` | Parsed CLI arguments: model, thinking, tools, extensions, session flags, messages, mode, etc. |
| `Mode` | String literal: `"text"` \| `"json"` \| `"rpc"` |
| `AppMode` | Internal: `"interactive"` \| `"print"` \| `"json"` \| `"rpc"` |
| `ResolvedSession` | Union: `path` \| `local` \| `global` \| `not_found` — result of resolving `--session <arg>` |
| `MainOptions` | Optional `extensionFactories` for programmatic use |

### Config (`coding-agent/src/config.ts`)

| Export | Description |
|---|---|
| `getAgentDir()` | Returns `~/.pi/agent` (or `PI_CODING_AGENT_DIR` override) |
| `VERSION` | Current version string from package.json |
| `isBunBinary` | Whether running from a compiled Bun binary (affects module resolution) |
| `getDocsPath()` | Absolute path to `packages/coding-agent/docs/` |
| `getExamplesPath()` | Absolute path to `packages/coding-agent/examples/` |
| `getReadmePath()` | Absolute path to `packages/coding-agent/README.md` |

### Runtime Creation

| Type | Description |
|---|---|
| `CreateAgentSessionRuntimeFactory` | Async factory that receives `{cwd, agentDir, sessionManager, sessionStartEvent}` and returns a runtime |
| `AgentSessionRuntimeDiagnostic` | `{type: "error"\|"warning"\|"info", message: string}` |
| `CreateAgentSessionOptions` | `model?`, `thinkingLevel?`, `scopedModels?`, `tools?`, `customTools?` |

## Flow (step-by-step)

### 1. Entry Point

```
main(args) → parseArgs(args) → resolveAppMode()
```

1. `main()` receives `process.argv` (or custom args for programmatic use)
2. Handles package/config subcommands early (`install`, `remove`, `list`, `config`)
3. `parseArgs()` extracts flags: `--model`, `--thinking`, `--tools`, `--extensions`, `--session`, `--continue`, `--resume`, `--fork`, `--print`, `--mode`, `--no-session`, `--system-prompt`, `--append-system-prompt`, etc.
4. Diagnostics from parsing are reported; errors cause `process.exit(1)`

### 2. Mode Resolution

```
resolveAppMode(parsed, stdinIsTTY):
  rpc mode flag → "rpc"
  json mode flag → "json"
  --print flag or piped stdin → "print"
  default → "interactive"
```

For non-interactive modes, `takeOverStdout()` redirects `console.log` to stderr so stdout is reserved for structured output.

### 3. Session Resolution

```
createSessionManager(parsed, cwd, sessionDir, settingsManager)
```

| Flag | Behavior |
|---|---|
| `--no-session` | `SessionManager.inMemory()` |
| `--fork <id>` | Find session, `SessionManager.forkFrom()` |
| `--session <id>` | Find session, `SessionManager.open()` (prompts to fork if different project) |
| `--resume` | Interactive session picker via `selectSession()` |
| `--continue` | `SessionManager.continueRecent()` |
| _(default)_ | `SessionManager.create()` |

Session ID resolution: if arg looks like a path, use directly; otherwise match as prefix against local sessions then global sessions.

### 4. Runtime Factory

The `createRuntime` factory is called with the resolved session context:

```
createAgentSessionServices() → creates:
  - SettingsManager (global + project settings)
  - ModelRegistry (built-in + custom models)
  - ResourceLoader (extensions, skills, prompts, themes, context files)
  - AuthStorage (API keys, OAuth tokens)

buildSessionOptions() → resolves:
  - Model (CLI → env → config → scoped → default)
  - Thinking level (CLI → scoped model → settings)
  - Tools (CLI filter or defaults)

createAgentSessionFromServices() → creates:
  - AgentSession (the core runtime)
```

### 5. Mode Dispatch

```
app mode:
  "rpc"         → runRpcMode(runtime)
  "interactive" → new InteractiveMode(runtime, {...}).run()
  "print"/"json" → runPrintMode(runtime, {mode, messages, ...})
```

### 6. Model Resolution Chain

```
1. --model / --provider flags → resolveCliModel()
2. scopedModels (from --models or settings.scopedModels) → first match
3. Saved default (settingsManager.getDefaultModel())
4. Built-in default model
```

Model patterns support `provider/pattern:thinking` syntax, e.g. `anthropic/sonnet:high`.

## Integration Points

| Connects to | How |
|---|---|
| **Agent Session (doc 04)** | `createAgentSessionFromServices()` builds the `AgentSession` |
| **Extension System (doc 06)** | `ResourceLoader` discovers and loads extensions during service creation |
| **Session Management (doc 07)** | `createSessionManager()` resolves the session file |
| **Model Registry (doc 12)** | `ModelRegistry` created during service creation, used for model resolution |
| **Modes (doc 10)** | Final dispatch to interactive/print/rpc mode |

## Extension Relevance

- Extensions can register **CLI flags** via `pi.registerFlag()`. These are parsed as `--flag-name` and available via `pi.getFlag()`.
- The `extensionFactories` option in `MainOptions` allows programmatic injection of extensions (useful for SDK/testing).
- Extensions are loaded during `createAgentSessionServices()` — **before** the session is fully initialized. Action methods (`sendMessage`, etc.) throw until `runner.bindCore()` is called.
- Extension flag values from CLI are set via `parsed.unknownFlags` → `setFlagValue()`.

## Open Questions

1. **`mom` package**: Purpose unclear from package.json alone. Name suggests "manager of managers" or internal tooling.
2. **Startup performance**: No caching of config/extension discovery across invocations. Each `pi` start re-discovers everything.
3. **`isBunBinary` detection**: How exactly is this detected? Affects module resolution strategy (virtualModules vs aliases).

## Key Files Read

| File | Lines | Purpose |
|---|---|---|
| `coding-agent/src/main.ts` | 731 | CLI entry, arg handling, runtime creation, mode dispatch |
| `coding-agent/src/config.ts` | ~50 | Path constants, version, Bun detection |
| `coding-agent/src/cli/args.ts` | ~400 | Argument parsing |
| `coding-agent/src/core/agent-session-services.ts` | ~300 | Service container creation |
| `coding-agent/src/core/agent-session-runtime.ts` | ~150 | Runtime factory wrapper |
