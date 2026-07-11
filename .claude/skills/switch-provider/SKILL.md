---
name: switch-provider
description: Toggle an existing NanoClaw agent group between AI providers (ollama, opencode/OpenRouter, claude) and/or models, restarting its container(s) in one shot via scripts/switch-provider.sh. Use when the user wants to flip a group to local Ollama for a while, switch back to their normal OpenRouter/Claude setup, or try a different model on the current provider. Does not set up a provider for the first time — see add-ollama-provider / add-opencode for that.
---

# Switch Provider

Flips an agent group's `provider` (and optionally `model`) and restarts its
container(s) — wraps two `ncl` calls in `scripts/switch-provider.sh` so this
is a single command instead of a lookup-ID-then-two-commands dance.

Only useful once a group is already configured for the providers you're
toggling between (see `add-ollama-provider` / `add-opencode` skills to set
one up the first time). This skill is for going back and forth afterward.

## Background: two different model-selection paths

NanoClaw has two independent mechanisms for picking a model, and which one
applies depends on the group's `provider`:

- **`claude` / `ollama` providers** — model is a `container_configs.model` DB
  column, read straight from the materialized `container.json` by the
  in-container agent-runner (`container/agent-runner/src/config.ts`) and
  passed to the Claude Agent SDK. Setting `--model` here takes effect on the
  next container restart alone — no other file to touch.

- **`opencode` provider** — model comes from the `OPENCODE_MODEL` host
  env var, set in `~/.config/nanoclaw/secrets.env`, loaded into the NanoClaw
  **host process's** environment at service start, then copied verbatim into
  the container by `src/providers/opencode.ts`. A `--model` value passed
  through this script is stored in the DB but the opencode provider ignores
  it at runtime. To change which OpenRouter model opencode uses, edit
  `secrets.env` (comment/uncomment your `OPENCODE_MODEL=...` line) and
  **restart the NanoClaw host service** — a plain container restart does not
  pick up a `secrets.env` edit, since it's only read once at process boot.

This means: toggling providers back and forth (ollama ⟷ opencode ⟷ claude)
is always a container-restart-only operation via this script. Changing the
_OpenRouter model while staying on opencode_ is a separate, heavier
operation this script does not perform.

## Prerequisites

- NanoClaw host is running (`ncl` needs `data/ncl.sock`) — verify with
  `ncl groups list`. If unreachable, start it (`pnpm run dev` or the
  installed service) first.
- `jq` on PATH (used to parse `ncl --json` output).
- The target group already has the provider(s) you're switching between
  configured/working at least once (ran `add-ollama-provider` and/or has an
  existing `opencode` + OpenRouter setup).
- For `ollama`: Ollama running on the host and the model already pulled —
  `curl -s http://localhost:11434/api/tags`.

## Usage

```bash
# List agent groups (folder, id, name) — use this to find <folder>
scripts/switch-provider.sh list

# Show a group's current provider/model
scripts/switch-provider.sh status <folder>

# Switch provider (+ optional model), then restart the group's container(s)
scripts/switch-provider.sh switch <folder> <provider> [model] [--rebuild] [--message "text"]
```

You never need to look up or pass an agent-group ID — the script resolves
`<folder>` to the ID itself via `ncl groups list`.

### Examples

```bash
# Route to local Ollama with a specific model
scripts/switch-provider.sh switch cli-with-mathipe ollama gpt-oss:120b-cloud

# Try a different Ollama model without touching anything else
scripts/switch-provider.sh switch cli-with-mathipe ollama deepseek-v4-flash:cloud

# Back to the existing OpenRouter/opencode setup
scripts/switch-provider.sh switch cli-with-mathipe opencode

# Route to a custom Anthropic-compatible endpoint via the claude provider
scripts/switch-provider.sh switch cli-with-mathipe claude claude-sonnet-4-5

# Restart with an on-wake message so the fresh container immediately
# confirms the switch instead of waiting for the next user message
scripts/switch-provider.sh switch cli-with-mathipe ollama gpt-oss:120b-cloud --message "Confirm which model you're running."
```

## What it does under the hood

```bash
ncl groups config update --id <resolved-id> --provider <provider> [--model <model>]
ncl groups restart --id <resolved-id> [--rebuild] [--message <text>]
```

Both run with `caller: host` (local socket connection), which bypasses the
`access: 'approval'` gate that applies to remote/agent-triggered CLI calls —
no approval prompt when run this way on the host machine.

`config update` only updates the DB row; nothing takes effect until the
`restart`. Without `--message`, `ncl groups restart` just stops the running
container — it starts fresh (with the new config) on the next incoming
message, per NanoClaw's on-demand spawn model.

## Verify

The script prints provider-specific verification hints after switching:

**ollama:**

```bash
curl -s http://localhost:11434/api/ps | grep '"name"'   # model shows once loaded (can take 10-30s cold)
docker exec $(docker ps --filter "name=nanoclaw-v2-<folder>" --format "{{.Names}}" | head -1) env | grep ANTHROPIC
# expect ANTHROPIC_BASE_URL=http://host.docker.internal:11434
```

**opencode:** reminds you that the active OpenRouter model is whatever
`OPENCODE_MODEL` is currently in `secrets.env` — this script does not change
or reload that.

**claude:** same `docker exec ... | grep ANTHROPIC` check, expecting your
configured custom `ANTHROPIC_BASE_URL` (or none, if using the real API).

## Troubleshooting

**"NanoClaw host not reachable"** — the host process isn't running or
`data/ncl.sock` doesn't exist yet. Start it (`pnpm run dev`, or
`launchctl kickstart`/`systemctl --user restart` for the installed service)
and retry.

**"no agent group with folder '...'"** — run `scripts/switch-provider.sh list`
to see valid folder names; they come from the `agent_groups.folder` column,
not the display name.

**Switched to ollama but agent still "sounds like OpenCode" or errors** —
container hasn't respawned yet (no message sent since restart), or Ollama is
still cold-loading the model. Send a message and check `ollama api/ps`.

**Switched back to opencode but it's using the wrong OpenRouter model** —
expected if you also meant to change `OPENCODE_MODEL` in `secrets.env`.
This script only flips `provider`; edit `secrets.env` and restart the host
service separately for that.

**Provider name typo (e.g. `olama`)** — the script warns but doesn't block
unknown provider names (forward-compatible with new providers), so a typo
will apply cleanly and then fail confusingly at container spawn. Recognized
names: `claude`, `ollama`, `opencode`.
