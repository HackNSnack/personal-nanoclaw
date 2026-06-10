# NixOS Deployment

This document covers the NixOS-specific deployment facts for this nanoclaw installation.
Full rationale and documentation lives in Obsidian at:
`Clients/Personal/AgentNotes/Reference/NanoClaw/NanoClaw NixOS Setup`

**NixOS config repo:** `~/NixOS-Hyprland`

---

## Install identity

This checkout's install slug is derived from its absolute path (see `src/install-slug.ts`):

```
Path:    /home/mathipe/Prosjekter/Personal/Slackbot/nanoclaw_bot/nanoclaw
Slug:    a72e394a   (= sha1(path)[:8])
Service: nanoclaw-v2-a72e394a
Image:   nanoclaw-agent-v2-a72e394a:latest
```

The slug is stamped on every Docker container spawned by this install (`--label nanoclaw-install=a72e394a`) so that orphan cleanup is scoped to this checkout. If the project directory ever moves, recompute the slug:
```bash
echo -n "/new/absolute/path" | sha1sum | cut -c1-8
```
Then update the slug in `modules/services/nanoclaw.nix` in the NixOS config repo.

---

## What's declared in NixOS config

| Piece | NixOS file | Notes |
|---|---|---|
| `onecli` CLI binary | `modules/packages/ai-tools.nix` | Inline derivation, v1.3.0, `autoPatchelfHook` for ELF patching |
| Systemd user service | `modules/services/nanoclaw.nix` | No auto-start; use `nanoclaw-start` |
| `~/.config/nanoclaw/` directory | `modules/services/nanoclaw.nix` | Via `systemd-tmpfiles` |
| `mount-allowlist.json` | `modules/services/nanoclaw.nix` | Seeded from Nix store on first boot, never overwritten |
| `logs/` directory | `modules/services/nanoclaw.nix` | Required by `StandardOutput = append:...` |
| `data/` directory | `modules/services/nanoclaw.nix` | SQLite database location (`src/config.ts → DATA_DIR`) |
| `nanoclaw-start`, `nanoclaw-stop`, `ncl` | `modules/services/nanoclaw.nix` | System-wide convenience scripts |

---

## Start / stop

```bash
nanoclaw-start   # starts OneCLI gateway (docker compose up -d) then nanoclaw service
nanoclaw-stop    # stops nanoclaw then OneCLI gateway
```

Logs:
```bash
journalctl --user -fu nanoclaw-v2-a72e394a
# or directly:
tail -f logs/nanoclaw.log
tail -f logs/nanoclaw.error.log
```

---

## Secrets — two files

Nanoclaw reads config via two mechanisms. Each variable must be in the right file.

### `<projectRoot>/.env` — read by `readEnvFile()` in `src/env.ts`

Parsed directly from disk; does **not** populate `process.env`. Variables read this way:
- `src/config.ts`: `ONECLI_URL`, `ONECLI_API_KEY`, `ASSISTANT_NAME`, `TZ`
- `src/channels/slack.ts`: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`

```bash
# Minimum contents
ONECLI_URL=http://localhost:10254
ASSISTANT_NAME=Andy
TZ=Europe/Oslo
ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
```

### `~/.config/nanoclaw/secrets.env` — loaded by systemd into `process.env`

The systemd service's `EnvironmentFile` injects these as real environment variables. Currently only one variable needs to be here:

```bash
SLACK_APP_TOKEN=xapp-...
```

**Why here:** `@chat-adapter/slack` reads `SLACK_APP_TOKEN` exclusively via `process.env.SLACK_APP_TOKEN` (socket mode). `src/channels/slack.ts` does not pass it through `readEnvFile`, so it must arrive as an environment variable, not from `.env`.

---

## Bootstrap checklist

- [x] `pnpm install --frozen-lockfile` — `better-sqlite3` native module compiled
- [x] `pnpm run build` — `dist/` exists
- [ ] `nixos-rebuild switch` — applies service, tmpfiles, packages
- [ ] `cd container && docker build -t nanoclaw-agent-v2-a72e394a:latest .`
- [x] `curl -fsSL onecli.sh/install | sh` — drops `~/.onecli/docker-compose.yml`
- [x] `onecli config set api-host http://127.0.0.1:10254`
      _(gateway binds to Docker bridge, not localhost — `localhost` = `[::1]` which isn't listening)_
- [ ] `onecli secrets create --name OpenRouter --type anthropic --value sk-or-v1-... --host-pattern openrouter.ai`
- [ ] `pnpm exec tsx scripts/init-cli-agent.ts --display-name "Mathipe" --agent-name "Personal Assistant"`
- [ ] Populate `<projectRoot>/.env` (see above)
- [ ] Create `~/.config/nanoclaw/secrets.env` with `SLACK_APP_TOKEN=xapp-...`
- [ ] `pnpm exec tsx setup/register.ts --platform-id <slack-channel-id>`

> **Note on `ANTHROPIC_BASE_URL`:** The `.env` already contains `ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1`. OneCLI intercepts HTTPS traffic to `openrouter.ai` and injects the API key — so `onecli secrets create` must use `--host-pattern openrouter.ai`, not `api.anthropic.com`.

---

## Switching between OpenRouter and Ollama

Switching is **per agent group**, not global. One group can use Claude via OpenRouter while another uses a local Ollama model simultaneously.

To switch a group to Ollama (once `ncl` is on PATH and the service is running):
```bash
ncl groups update <group-id> --provider ollama
ncl groups update <group-id> --model gemma4:latest   # exact name from `ollama list`
```

To revert:
```bash
ncl groups update <group-id> --provider claude
ncl groups update <group-id> --model claude-sonnet-4-5  # or unset
```

Ollama must be running on the host before spawning a container with `--provider ollama`. Start it manually (`ollama serve`) — no NixOS service declaration is used.

See `docs/ollama.md` for full details on the network isolation and model selection.

---

## Node version note

The engine requirement is `>=20`. The system runs `pkgs.nodejs` (currently Node 24). `better-sqlite3` is compiled against whichever Node version is active at `pnpm install` time. If a NixOS upgrade bumps the Node major version, re-run `pnpm install` in this directory to recompile the native module against the new version before starting the service.
