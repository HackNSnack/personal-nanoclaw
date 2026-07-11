---
name: add-ollama-provider
description: Route a NanoClaw agent group to a local Ollama model instead of the Anthropic API. Ollama speaks the Anthropic API natively (v1/messages), so the container-side harness needs zero behavioral changes — just a provider-registry entry (already present), a per-group DB config, and a container restart. Use when the user wants to run their agent locally, cut API costs, or experiment with open-weight models. See docs/ollama.md for background.
---

# Add Ollama Provider

Routes an agent group to a local Ollama instance instead of the Anthropic API.
See `docs/ollama.md` for how this works and the tradeoffs involved.

NanoClaw's provider mechanism is a two-sided registry: a host-side entry
(`src/providers/ollama.ts`) supplies env vars + blocked hosts at container
spawn, and a container-side entry (`container/agent-runner/src/providers/claude.ts`,
registered under the name `ollama`) picks the runtime class. Both already
exist in this codebase — this skill is about _configuring a group_ to use
them, not writing new provider code. If you're on a checkout old enough that
`ollama` isn't a registered provider on both sides, see "If the provider
isn't registered" below before proceeding.

## Prerequisites

1. **Ollama is installed and running** on the host — verify: `curl -s http://localhost:11434/api/tags`
2. **A model is pulled or available** — e.g. `ollama pull gemma3` or `ollama pull qwen3-coder` (or a `:cloud` model if using Ollama Cloud, which still routes through the local daemon)
3. **On Linux: Ollama must bind beyond loopback.** `host.docker.internal` from
   inside a container resolves to the docker0 bridge gateway IP (e.g.
   `172.17.0.1`), not `127.0.0.1` — Ollama's default bind. Check:

   ```bash
   ss -ltnp | grep 11434
   # 127.0.0.1:11434  <- broken from inside a Linux container
   # 0.0.0.0:11434    <- reachable
   ```

   If it's loopback-only, restart with `OLLAMA_HOST=0.0.0.0:11434 ollama serve`
   (or `OLLAMA_HOST=172.17.0.1:11434` to scope exposure to just the docker
   bridge — check your actual bridge IP with `ip addr show docker0`). This
   caveat doesn't apply to macOS (Docker Desktop's VM networking handles it
   transparently). See `docs/ollama.md` for details.

4. **The agent group already exists** — run `/init-first-agent` first if needed
5. **NanoClaw host is reachable** — `ncl groups list` should work, not error
   with a socket-connect failure. Start it (`pnpm run dev` or the installed
   service) if not.

## If the provider isn't registered

Check both sides are wired:

```bash
grep -n "registerProviderContainerConfig('ollama'" src/providers/ollama.ts
grep -n "registerProvider('ollama'" container/agent-runner/src/providers/claude.ts
```

If the first is missing, the host-side provider was never added — see
`docs/ollama.md`'s "What Was Changed at the Code Level" section for the
host-side pieces (`src/providers/ollama.ts`, `src/providers/index.ts`,
`src/container-runner.ts`) and port them in.

If the second is missing (host-side present, container-side absent), you'll
see containers fail at spawn with `Unknown provider: ollama. Registered:
claude, mock, opencode` in `docker logs`. Fix is one line in
`container/agent-runner/src/providers/claude.ts`, right after the existing
`registerProvider('claude', ...)` call:

```typescript
// Ollama exposes an Anthropic-compatible /v1/messages endpoint, so routing to
// it needs no separate runtime — just this same harness pointed at a
// different ANTHROPIC_BASE_URL (injected host-side).
registerProvider('ollama', (opts) => new ClaudeProvider(opts));
```

This file is bind-mounted read-only into the container and run directly via
`bun run /app/src/index.ts` — no image rebuild needed, a container restart
picks it up.

## 1. Identify the setup

Ask the user (plain text, not AskUserQuestion):

1. **Which agent group?** List available: `ncl groups list` (or `scripts/switch-provider.sh list`)
2. **Which Ollama model?** List available: `curl -s http://localhost:11434/api/tags | grep '"name"'`

Record as `FOLDER` and `MODEL`. Blocking `api.anthropic.com`/`openrouter.ai`
is not optional here — it's baked into the `ollama` provider's
`blockedHosts` unconditionally (`src/providers/ollama.ts`), so there's no
"decline" path to ask about.

## 2. Switch the group

```bash
ncl groups config update --id <group-id> --provider ollama --model <MODEL>
ncl groups restart --id <group-id>
```

Or, if `scripts/switch-provider.sh` exists in this checkout (resolves
`<FOLDER>` to the group ID for you and runs both steps):

```bash
scripts/switch-provider.sh switch <FOLDER> ollama <MODEL>
```

Nothing is written to `container.json` or `settings.json` by hand — the
`provider` and `model` are `container_configs` DB columns, materialized
into `groups/<FOLDER>/container.json` fresh on every container spawn. The
env vars (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `NO_PROXY`) and
`blockedHosts` come from the `ollama` provider's host-side registration,
applied as Docker CLI flags (`-e`, `--add-host`) at spawn time — never
serialized into any file.

## 3. Verify

Send a message to the agent (or use `--message "..."` on the restart above
to trigger an immediate on-wake response). Then confirm:

```bash
# Ollama shows the model as active (cloud models won't show local process
# activity the same way, but the daemon still proxies the request)
curl -s http://localhost:11434/api/ps | grep '"name"'

# Container has the right env vars + blocked hosts
CTR=$(docker ps --filter "name=nanoclaw-v2-<FOLDER>" --format "{{.Names}}" | head -1)
docker inspect "$CTR" --format '{{json .HostConfig.ExtraHosts}}'
docker exec "$CTR" env | grep ANTHROPIC

# No fatal provider errors at container start
docker logs "$CTR" 2>&1 | grep -i "agent-runner\|fatal"
```

Expected: `api.anthropic.com:0.0.0.0` and `openrouter.ai:0.0.0.0` in
ExtraHosts, `ANTHROPIC_BASE_URL=http://host.docker.internal:11434`, and
`Starting v2 agent-runner (provider: ollama)` with no `Fatal error` line
after it.

## Reverting to Claude

```bash
ncl groups config update --id <group-id> --provider claude
ncl groups restart --id <group-id>
```

Or `scripts/switch-provider.sh switch <FOLDER> claude [model]`. No rebuild
needed — same DB-column-to-container.json path as switching, just the
reverse direction.

## Troubleshooting

**Repeated `Error: API retry (retryable: true)` in container logs, no
response ever arrives:** almost always the Linux bind issue from
Prerequisites — Ollama listening on `127.0.0.1` only. Verify with
`ss -ltnp | grep 11434` and fix with `OLLAMA_HOST=0.0.0.0:11434 ollama serve`
(or the docker-bridge-scoped variant). This is the Claude Agent SDK's own
internal retry loop against a connection that never completes — it will not
self-resolve without fixing the Ollama bind.

**`Fatal error: Unknown provider: ollama. Registered: claude, mock, opencode`
in container logs:** the container-side registration is missing — see "If
the provider isn't registered" above.

**Agent hangs, no response, but Ollama's bind is fine:** Ollama may be
loading the model cold (large local models take 10–30s). Watch
`curl -s http://localhost:11434/api/ps` — the model appears once loaded.

**"model not found" error in container logs:** the model name doesn't match
what Ollama has. Run `ollama list` on the host and use the exact name shown.

**Responses claim to be Claude:** the model was trained on data that
includes Claude conversations. Add a line to `groups/<FOLDER>/CLAUDE.md`
telling it what model it actually runs on.

**Agent responds but Ollama shows no activity:** `NO_PROXY` may not have
taken effect for `http_proxy` (lowercase) — check
`docker exec <container> env | grep -i proxy`. Both `NO_PROXY` and
`no_proxy` should already be set by the `ollama` provider; if not, that's a
regression in `src/providers/ollama.ts`.
