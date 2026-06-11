---
tags:
  - nanoclaw
  - opencode
  - debugging
  - openrouter
type: work
status: done
---

# NanoClaw — OpenCode Provider Setup

**Goal:** Get `pnpm run chat hi` working, then switch to the OpenCode provider so non-Anthropic models (DeepSeek, Qwen, etc.) can be used via OpenRouter.

---

## Problem

`pnpm run chat hi` spins up a container but the agent never replies. Container logs show:

```
[poll-loop] Result: There's an issue with the selected model (claude-opus-4-8[1m]).
It may not exist or you may not have access to it.
[poll-loop] WARNING: agent output had no <message to="..."> blocks — nothing was sent
```

The `[1m]` suffix is a stray ANSI bold escape code in the log — the actual model string is `claude-opus-4-8`.

---

## Root Cause

`container_configs.model` is `NULL`. The full chain:

```
container_configs.model = NULL
  → materializeContainerJson() writes container.json with no "model" field
  → agent runner config.ts reads model: undefined
  → Claude Code SDK v2.1.154 picks its own built-in default: "claude-opus-4-8"
  → Sent to https://openrouter.ai/api/v1/messages
  → OpenRouter: model not found
```

Claude Code's default model (`claude-opus-4-8`) is not a valid OpenRouter model ID.

---

## Full System State (as of 2026-06-11)

| Item | Value / Status |
|---|---|
| Agent group | `ag-1781098614662-lx2src` (Personal Assistant) |
| Container image | `nanoclaw-agent-v2-a72e394a:latest` |
| Claude Code version | `2.1.154` |
| `container_configs.model` | `NULL` — **root cause** |
| `container_configs.provider` | `NULL` → defaults to `claude` |
| `agent_groups.agent_provider` | `opencode` — legacy/unused by container runner (not in resolution chain) |
| OneCLI secret | `OpenRouter`, type `generic`, `Authorization: Bearer`, host `openrouter.ai` — **correct** |
| `ANTHROPIC_BASE_URL` | `https://openrouter.ai/api/v1` (in `.env`) |
| OneCLI errors | Fixed (docker-compose.override.yml applied) |

### Provider resolution chain (host-side)

```
session.agent_provider → container_configs.provider → default: 'claude'
```

`agent_groups.agent_provider` is **not** in this chain — it's read by the host for side-effects (XDG mount, OPENCODE_* env passthrough) but does not propagate into `container.json`. The container always reads its provider from `container.json`.

---

## Fix Options

### Path A — Claude Code SDK + OpenRouter model (quick fix, Claude-only)

Set a valid model in `container_configs`:

```bash
ncl groups config update --id ag-1781098614662-lx2src --model claude-sonnet-4-5-20250514
```

Restart and test. Works for Claude models only.

### Path B — OpenCode provider (chosen path)

The container image already has `opencode` provider files (`container/agent-runner/src/providers/opencode.ts` etc.). OpenCode natively supports any provider OpenRouter exposes (DeepSeek, Qwen, etc.).

Configuration:
- `OPENCODE_PROVIDER` — e.g. `openrouter`
- `OPENCODE_MODEL` — e.g. `openrouter/deepseek/deepseek-v3`
- `OPENCODE_SMALL_MODEL` — optional
- `ANTHROPIC_BASE_URL` — set to provider base URL (already `https://openrouter.ai/api/v1`)

Credentials: register API key in OneCLI with matching `--host-pattern`. OpenRouter key already registered.

See skill: `.pi/skills/add-opencode/SKILL.md`

---

## Setup Steps — Path B

### Pre-flight — all ✅ (skip install steps)

- ✅ `src/providers/opencode.ts` exists
- ✅ `container/agent-runner/src/providers/opencode.ts` exists
- ✅ `import './opencode.js'` in `src/providers/index.ts`
- ✅ `import './opencode.js'` in `container/agent-runner/src/providers/index.ts`
- ✅ `@opencode-ai/sdk@1.4.17` in `container/agent-runner/package.json`
- ✅ `opencode-ai@1.4.17` in `container/Dockerfile`

No install steps needed — go straight to Configuration.

### Configuration

1. Set provider + model in `container_configs`:
   ```bash
   ncl groups config update --id ag-1781098614662-lx2src --provider opencode --model openrouter/deepseek/deepseek-v3
   ```

2. Add env vars to `.env`:
   ```
   OPENCODE_PROVIDER=openrouter
   OPENCODE_MODEL=openrouter/<model-id>
   OPENCODE_SMALL_MODEL=openrouter/<model-id>
   # ANTHROPIC_BASE_URL already set to https://openrouter.ai/api/v1
   ```

3. Grant OneCLI OpenRouter secret to agent (safe-merge pattern):
   ```bash
   AGENT_ID=$(onecli agents list | jq -r '.data[] | select(.identifier=="ag-1781098614662-lx2src") | .id')
   CURRENT=$(onecli agents secrets --id "$AGENT_ID" | jq -r '[.data[]] | join(",")')
   MERGED=$(printf '%s' "$CURRENT,<openrouter-secret-id>" | tr ',' '\n' | sort -u | paste -sd ',' -)
   onecli agents set-secrets --id "$AGENT_ID" --secret-ids "$MERGED"
   ```

4. Propagate source overlay to existing session (if needed):
   ```bash
   for overlay in data/v2-sessions/*/agent-runner-src/providers/; do
     [ -d "$overlay" ] || continue
     cp container/agent-runner/src/providers/opencode.ts "$overlay"
     cp container/agent-runner/src/providers/mcp-to-opencode.ts "$overlay"
     cp container/agent-runner/src/providers/index.ts "$overlay"
   done
   ```

5. Rebuild + restart:
   ```bash
   pnpm run build
   ./container/build.sh
   nanoclaw-stop && nanoclaw-start
   ```

---

## Resolution (2026-06-11)

`pnpm run chat hi` now works and replies correctly. Three bugs were found and fixed:

| # | Bug | Fix |
|---|-----|-----|
| 1 | `buildOpenCodeConfig` registered built-in OpenRouter models as custom entries using `/`-delimited IDs (e.g. `deepseek/deepseek-v4-pro`). OpenCode re-parsed these as `{provider}/{model}`, producing `providerID: "deepseek"` — an unconfigured provider. | Removed the entire `models:` block from `providerOptions`. Built-in models are already registered by OpenCode natively. |
| 2 | A stale `continuation:opencode` row (`ses_14a3a629dffeGt8LQtWCcGqo3R`) was in `outbound.db` from a prior session that had never received a successful assistant turn. Every container start tried to resume this dead session and immediately errored. | Deleted the row with `sqlite3 … DELETE FROM session_state WHERE key = 'continuation:opencode'`. |
| 3 | `STALE_SESSION_RE` in `opencode.ts` didn't match `"Model not found"` or `"ProviderModelNotFoundError"`, so the poll-loop never auto-cleared the bad continuation — causing an infinite error loop across restarts. | Added both patterns to the regex. |

Full runbook for future occurrences: [[Clients/Personal/AgentNotes/Reference/NanoClaw/OpenCode ProviderModelNotFoundError — Stale Session Loop]]

---

## Related

- [[Clients/Personal/AgentNotes/Reference/NanoClaw/NanoClaw NixOS Setup]]
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/NanoClaw Operations]]
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/OpenCode ProviderModelNotFoundError — Stale Session Loop]]
- Skill: `nanoclaw/.pi/skills/add-opencode/SKILL.md`
