---
tags: [nanoclaw, env, config, nixos, opencode, openrouter]
type: reference
status: active
---

# NanoClaw Env Var Loading Architecture — `secrets.env` vs `.env`

## Overview

Nanoclaw uses **two completely separate env var mechanisms** that look similar but serve different purposes. Getting them confused means model/config changes silently have no effect. This doc maps every relevant variable to exactly where it is read and how it flows.

---

## The Two Files

| File | Loaded by | Effect |
|---|---|---|
| `~/.config/nanoclaw/secrets.env` | systemd `EnvironmentFile=` in `~/NixOS-Hyprland/modules/services/nanoclaw.nix` | → directly into `process.env` of the nanoclaw host process |
| `<projectroot>/.env` | `readEnvFile(keys)` in `src/env.ts` | → returns only explicitly-named keys; **never populates `process.env`** |

### Key constraint on `.env`

`src/env.ts` `readEnvFile()` is only ever called for these specific keys:

| Caller | Keys requested |
|---|---|
| `src/config.ts:9` | `ASSISTANT_NAME`, `ASSISTANT_HAS_OWN_NUMBER`, `ONECLI_URL`, `ONECLI_API_KEY`, `TZ` |
| `src/channels/slack.ts:16` | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN` |
| `src/providers/claude.ts:21` | `ANTHROPIC_BASE_URL` |

**Everything else in `.env` is silently ignored.**

---

## How `OPENCODE_*` Vars Reach the Container

Flow: `secrets.env` → systemd `EnvironmentFile` → host `process.env` → `src/providers/opencode.ts` → container env.

The host-side opencode provider (`src/providers/opencode.ts:40-44`) iterates `ctx.hostEnv` (which equals `process.env`, set in `src/container-runner.ts:260`) and forwards every key starting with `OPENCODE_`:

```typescript
// src/providers/opencode.ts
for (const [key, value] of Object.entries(ctx.hostEnv)) {
  if (key.startsWith('OPENCODE_') && value) env[key] = value;
}
```

The container agent-runner then reads them directly from `process.env`:
- `container/agent-runner/src/providers/opencode.ts:202` → `process.env.OPENCODE_PROVIDER`
- `container/agent-runner/src/providers/opencode.ts:203` → `process.env.OPENCODE_MODEL`
- `container/agent-runner/src/providers/opencode.ts:204` → `process.env.OPENCODE_SMALL_MODEL`
- `container/agent-runner/src/providers/opencode.ts:217` → `process.env.OPENCODE_OPENROUTER_ROUTING`
- `container/agent-runner/src/providers/opencode.ts:40` → `process.env.OPENCODE_RETRY_ENABLED`
- `container/agent-runner/src/providers/opencode.ts:43` → `process.env.OPENCODE_RETRY_MAX_ATTEMPTS`
- `container/agent-runner/src/providers/opencode.ts:402` → `process.env.OPENCODE_IDLE_TIMEOUT_MS`

---

## Variable-by-Variable Map

### From `secrets.env` (all go into `process.env` via EnvironmentFile)

| Variable | Where read | Default | Notes |
|---|---|---|---|
| `OPENCODE_PROVIDER` | `container/.../opencode.ts:202` | `anthropic` | Set to `openrouter` |
| `OPENCODE_MODEL` | `container/.../opencode.ts:203` | — | Must use `openrouter/<id>` prefix format |
| `OPENCODE_SMALL_MODEL` | `container/.../opencode.ts:204` | — | Same prefix format |
| `OPENCODE_OPENROUTER_ROUTING` | `container/.../opencode.ts:217` | — | JSON string, parsed at container startup |
| `OPENCODE_RETRY_ENABLED` | `container/.../opencode.ts:40` | `true` | Only useful to set `false` |
| `OPENCODE_RETRY_MAX_ATTEMPTS` | `container/.../opencode.ts:43` | `3` | |
| `OPENCODE_IDLE_TIMEOUT_MS` | `container/.../opencode.ts:402` | `300000` (5min) | Actively customised to `120000` (2min) |
| `SLACK_CLIENT_PING_TIMEOUT_MS` | `src/channels/slack.ts:38` | `15000` | HOST-side; not forwarded to container |
| `SLACK_SERVER_PING_TIMEOUT_MS` | `src/channels/slack.ts:39` | `30000` | HOST-side; not forwarded to container |
| `SLACK_APP_TOKEN` | `@chat-adapter/slack` dist `index.js:4210` | — | See SLACK_APP_TOKEN section below |
| `OPENROUTER_API_KEY` | `src/providers/opencode.ts:49` | — | Special-cased: host reads it, falls back to `onecli-managed` sentinel |

### From `.env` in project root (`readEnvFile` only)

| Variable | Where read | Notes |
|---|---|---|
| `ONECLI_URL` | `src/config.ts:9` | |
| `ONECLI_API_KEY` | `src/config.ts:9` | |
| `ASSISTANT_NAME` | `src/config.ts:9` | |
| `TZ` | `src/config.ts:9` | |
| `SLACK_BOT_TOKEN` | `src/channels/slack.ts:16` | |
| `SLACK_SIGNING_SECRET` | `src/channels/slack.ts:16` | |
| `SLACK_APP_TOKEN` | `src/channels/slack.ts:16` | Also readable from `process.env` — see SLACK_APP_TOKEN section below |
| `ANTHROPIC_BASE_URL` | `src/providers/claude.ts:21` | |

---

## SLACK_APP_TOKEN — Two Valid Paths

This token is unusual because it has **two independent paths** to reach the Slack SDK:

**Path A — via `.env`:**
`src/channels/slack.ts:16` reads it via `readEnvFile()` → passed explicitly as `appToken: env.SLACK_APP_TOKEN` to `createSlackAdapter` → SDK uses config value.

**Path B — via `secrets.env`:**
`readEnvFile()` returns `undefined` (key not in `.env`) → `appToken: undefined` passed to SDK → `@chat-adapter/slack` dist `index.js:4210` falls back:
```javascript
const appToken = config?.appToken ?? process.env.SLACK_APP_TOKEN;
```
→ reads it from `process.env` (which secrets.env populated via EnvironmentFile).

**Conclusion:** Either file works on its own. If it's in BOTH, the `.env` version wins (nanoclaw passes it explicitly, so the `??` fallback is never reached). The NixOS module intentionally puts it in `secrets.env` because early versions of `@chat-adapter/slack` read it exclusively from `process.env` — the current code supports both paths.

---

## What's Redundant / Dead in the Config Files

### In `secrets.env`

- ❌ **Lines 2–3** (`OPENCODE_MODEL=deepseek/deepseek-v4-flash`, `OPENCODE_SMALL_MODEL=deepseek/deepseek-v4-flash`) — overwritten by the `openrouter/` prefixed duplicates further down the file; systemd takes the last occurrence.
- ⚠️ `OPENCODE_RETRY_ENABLED=true` — redundant, equals default.
- ⚠️ `OPENCODE_RETRY_MAX_ATTEMPTS=3` — redundant, equals default.
- ⚠️ `SLACK_CLIENT_PING_TIMEOUT_MS=15000` — redundant, equals default.
- ⚠️ `SLACK_SERVER_PING_TIMEOUT_MS=30000` — redundant, equals default.

### In project `.env`

- ❌ `OPENCODE_PROVIDER`, `OPENCODE_MODEL`, `OPENCODE_SMALL_MODEL` — **never read**; `readEnvFile` doesn't request these keys.
- ❌ `DEBUG=*` — **never read** by `readEnvFile`; also not forwarded to container (only `OPENCODE_*` prefix is forwarded).

---

## To Change the Model

Edit `~/.config/nanoclaw/secrets.env`, not `.env`:

```bash
OPENCODE_MODEL=openrouter/mistralai/mistral-small-3.2-24b-instruct
OPENCODE_SMALL_MODEL=openrouter/mistralai/mistral-small-3.2-24b-instruct
```

Then restart: `nanoclaw-restart`

**Model ID format**: always `openrouter/<provider>/<model-slug>` when `OPENCODE_PROVIDER=openrouter`.

---

## NixOS wiring

The `EnvironmentFile` is declared in `~/NixOS-Hyprland/modules/services/nanoclaw.nix`:

```nix
EnvironmentFile = "-/home/${username}/.config/nanoclaw/secrets.env";
```

The `-` prefix means systemd won't fail if the file is absent. This file is NOT auto-generated — it must be manually maintained.

The systemd unit itself does NOT have `EnvironmentFile` for the project `.env` — the project root `.env` is only read at the TypeScript level via `readEnvFile()`.

---

## Key Source Files

| File | Role |
|---|---|
| `src/env.ts` | `readEnvFile()` — selective `.env` parser, never touches `process.env` |
| `src/config.ts:9` | Reads `ASSISTANT_NAME`, `ONECLI_URL`, etc. from `.env` |
| `src/channels/slack.ts:16` | Reads Slack tokens from `.env`; reads ping timeouts from `process.env` |
| `src/providers/opencode.ts` | Host-side: forwards `OPENCODE_*` from `process.env` into container env |
| `src/container-runner.ts:260` | Sets `hostEnv: process.env` passed to provider configs |
| `container/agent-runner/src/providers/opencode.ts` | In-container: reads all `OPENCODE_*` vars, constructs opencode config |
| `node_modules/@chat-adapter/slack/dist/index.js:4210` | `config?.appToken ?? process.env.SLACK_APP_TOKEN` fallback |
| `~/NixOS-Hyprland/modules/services/nanoclaw.nix` | Systemd unit; declares `EnvironmentFile` for `secrets.env` |

## Related

- [[Clients/Personal/AgentNotes/Reference/NanoClaw/NanoClaw NixOS Setup]]
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/OpenCode + OpenRouter Configuration]]
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/NanoClaw Operations]]
