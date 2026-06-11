---
tags:
  - nanoclaw
  - nixos
  - flake
  - docker
  - onecli
  - selfhosted
type: reference
status: active
---

# NanoClaw NixOS Setup

**Purpose:** Full configuration map for running NanoClaw on NixOS. `nanoclaw.sh` assumes a conventional Linux distro with dynamic installs (`apt`, `curl | sh`). On NixOS everything must be declared. This note documents what each setup step actually does and exactly where it is declared.

**Last updated:** 2026-06-10  
**Repo:** `~/Prosjekter/Personal/Slackbot/nanoclaw_bot/nanoclaw` (fork of `nanocoai/nanoclaw` v2)  
**NixOS config:** `~/NixOS-Hyprland`

---

## Current Deployment Status

### ✅ Implemented in NixOS config (applied on next `nixos-rebuild switch`)

| What | Where | Notes |
|---|---|---|
| `virtualisation.docker.enable` | `hosts/default/config.nix` | Was already present |
| User `mathipe` in `docker` group | `hosts/default/users.nix` | Was already present |
| OneCLI CLI binary (`onecli`) | `modules/packages/ai-tools.nix` | Inline derivation, v1.3.0 |
| Nanoclaw systemd user service | `modules/services/nanoclaw.nix` | No auto-start; use `nanoclaw-start` |
| `mount-allowlist.json` seed | `modules/services/nanoclaw.nix` | Via `systemd-tmpfiles` |
| `logs/` and `data/` directories | `modules/services/nanoclaw.nix` | Via `systemd-tmpfiles` |
| `nanoclaw-start`, `nanoclaw-stop`, `ncl` | `modules/services/nanoclaw.nix` | System packages |
| `~/.onecli/docker-compose.override.yml` | `modules/services/nanoclaw.nix` | Via `systemd-tmpfiles` `L+` symlink — fixes Docker bridge binding |

### ✅ Already done manually (one-time, no action needed)

| What | Evidence |
|---|---|
| `pnpm install --frozen-lockfile` | `node_modules/.pnpm` populated (319 entries), `better-sqlite3` native module compiled for Node 24 |
| `pnpm run build` | `dist/` directory exists |
| OneCLI installer | `~/.onecli/docker-compose.yml` present |
| `onecli config set api-host http://127.0.0.1:10254` | `~/.onecli/config.json` set |
| `onecli secrets create` (OpenRouter) | Confirmed present via `onecli secrets list` |
| `docker build -t nanoclaw-agent-v2-a72e394a:latest` | Container image exists; containers successfully spawned |
| `tsx scripts/init-cli-agent.ts` | `data/v2.db` seeded; messages routing to agent group |
| `<projectRoot>/.env` | ONECLI_URL, SLACK tokens, ANTHROPIC_BASE_URL all present |
| `~/.config/nanoclaw/secrets.env` | `SLACK_APP_TOKEN` present; Slack socket mode connecting |
| `pnpm exec tsx scripts/upgrade-state.ts set` | Upgrade tripwire cleared; service starts cleanly |
| `setup/register.ts --platform-id <id>` | Slack channel wired; messages received and routed |

### ⚠️ Pending — docker-compose.override.yml binding fix

The `nanoclaw.nix` module now deploys `~/.onecli/docker-compose.override.yml` via `systemd-tmpfiles`. After the next `nixos-rebuild switch`, run:

```bash
systemd-tmpfiles --create
cd ~/.onecli && docker compose down && docker compose up -d
nanoclaw-start
```

This fixes agent containers being unable to reach the OneCLI proxy (see [Docker Bridge Binding Fix](#docker-bridge-binding-fix) below).

### ✅ Ollama / OpenRouter switching — implemented

Per-agent-group switching between local Ollama and OpenRouter is implemented in the nanoclaw repo. See `docs/ollama.md` for details.

- Set `--provider ollama` on a group → uses `http://host.docker.internal:11434`, bypasses OneCLI, blocks external APIs
- Set `--provider claude` (default) → uses OpenRouter via OneCLI proxy
- Ollama is started manually (`ollama serve`) — no NixOS service needed

---

### Deliberate deviations from original plan

- **No user lingering** — machine is either on + logged in, or off. User services start on login and stop on shutdown. No `systemd.tmpfiles` linger rule needed.
- **No systemd service for OneCLI gateway** — the gateway (Docker Compose stack) is managed manually via `nanoclaw-start` / `nanoclaw-stop` scripts, not wrapped in a NixOS systemd service.
- **Not using home-manager** — nanoclaw is declared in a system-level NixOS module (`modules/services/nanoclaw.nix`) rather than a home-manager module.
- **`pkgs.nodejs` (v24), not `nodejs_22`** — engine requirement is `>=20`; the system currently runs Node 24.13.0. The service uses the same `pkgs.nodejs` derivation that `dev-node.nix` installs, keeping the version consistent with the one that compiled `better-sqlite3`'s native module.
- **OneCLI CLI in `ai-tools.nix`** — defined as an inline derivation alongside Claude Code and Gemini CLI, not as a separate `pkgs/` file.

---

## How `nanoclaw.sh` Works (Summary)

Two phases:

1. **`setup.sh` (bootstrap)** — installs Node 22+, pnpm 10, runs `pnpm install --frozen-lockfile`, verifies `better-sqlite3` native module compiled.
2. **`pnpm run setup:auto`** — an interactive sequencer running these steps in order:

| Step | What it does |
|---|---|
| `environment` | Detects platform, Docker, existing config |
| `container` | Builds the agent Docker image from `container/Dockerfile` |
| `onecli` | Installs OneCLI gateway (Docker Compose stack) + CLI binary |
| `auth` | Registers API credential with OneCLI vault |
| `mounts` | Writes `~/.config/nanoclaw/mount-allowlist.json` |
| `service` | Compiles TypeScript, writes + starts a systemd user unit |
| `cli-agent` | Seeds the initial agent group into the SQLite database |
| `timezone` | Detects and persists timezone |
| `channel` | Optional: pairs Telegram, Discord, WhatsApp, Slack, etc. |
| `verify` | Confirms credentials, service, and channels are all wired up |

On NixOS, phases 1 and 2 cannot run as-is. Software installs are handled by Nix; the **configuration outputs** of each step are declared instead.

---

## What's Declared and Where

### 1. `modules/packages/ai-tools.nix` — OneCLI CLI binary

The `onecli` management binary is packaged as an inline Nix derivation:

```nix
onecli-cli = pkgs.stdenv.mkDerivation rec {
  pname = "onecli-cli";
  version = "1.3.0";
  src = pkgs.fetchurl {
    url = "https://github.com/onecli/onecli-cli/releases/download/v${version}/onecli_${version}_linux_amd64.tar.gz";
    hash = "sha256-2AQoWi7JCuneQw69XuWgfHDPMTqf2XveXxEgQfPeDmw=";
  };
  nativeBuildInputs = [ pkgs.autoPatchelfHook ];
  ...
};
```

**Why `autoPatchelfHook`:** The pre-built Go binary references glibc at `/lib`. NixOS has no `/lib` — `autoPatchelfHook` rewrites the ELF RPATH to point into the Nix store instead.

**To update:** fetch the new release tarball hash with:
```bash
nix-prefetch-url https://github.com/onecli/onecli-cli/releases/download/vX.Y.Z/onecli_X.Y.Z_linux_amd64.tar.gz
nix hash to-sri --type sha256 <base32-hash>
```

---

### 2. `modules/services/nanoclaw.nix` — Everything else

A single system-level NixOS module. Source of truth for the full nanoclaw declaration.

#### Systemd user service

Unit name: `nanoclaw-v2-a72e394a`

The slug `a72e394a` is `sha1("/home/mathipe/Prosjekter/Personal/Slackbot/nanoclaw_bot/nanoclaw")[:8]`, computed by `src/install-slug.ts`. It namespaces every Docker container this install spawns (`--label nanoclaw-install=a72e394a`) so that orphan cleanup is scoped to this checkout. If the project directory ever moves, recompute:
```bash
echo -n "/new/absolute/path" | sha1sum | cut -c1-8
```

The service is declared with **no `wantedBy`** — it does not auto-start on login. Use `nanoclaw-start` instead.

Key `serviceConfig` entries and why:

| Key | Value | Why |
|---|---|---|
| `ExecStart` | `${pkgs.nodejs}/bin/node .../dist/index.js` | Runs compiled host process; same `nodejs` derivation as dev-node.nix ensures ABI consistency with `better-sqlite3` |
| `WorkingDirectory` | project root | `readEnvFile()` in `src/env.ts` reads `.env` from `process.cwd()` |
| `Restart` | `on-failure` | Recovers from crashes but not from intentional `nanoclaw-stop` |
| `KillMode` | `process` | Kills only the host process; per-session Docker containers have their own lifecycle |
| `HOME` | `/home/mathipe` | `os.homedir()` calls need this (e.g. resolving `~/.config/nanoclaw/`) |
| `PATH` | nodejs + docker + system | `docker` needed for container spawning at runtime |
| `TZ` | pulled from `config.time.timeZone` | `src/config.ts` uses this for scheduled task timezone resolution |
| `EnvironmentFile` | `~/.config/nanoclaw/secrets.env` (optional) | Injects `SLACK_APP_TOKEN` into `process.env` — see Secrets section |
| `StandardOutput/Error` | `append:.../logs/nanoclaw.log` | Survives restarts; easy to tail from project dir |

#### systemd-tmpfiles rules

| Rule | Creates | Why |
|---|---|---|
| `d ~/.config/nanoclaw` | Config directory | Holds `mount-allowlist.json` and `secrets.env` |
| `C ~/.config/nanoclaw/mount-allowlist.json` | Seeded from Nix store | `src/config.ts` reads this on every container spawn. `C` = copy only if absent, so manual edits survive rebuilds |
| `d <project>/logs` | Log directory | `StandardOutput = append:...` will fail to start if this is absent |
| `d <project>/data` | Database directory | `src/config.ts` resolves `DATA_DIR` as `<projectRoot>/data` |
| `d ~/.onecli` | OneCLI directory | Ensures dir exists before the `L+` rule below |
| `L+ ~/.onecli/docker-compose.override.yml` | Nix-store symlink | Overrides port bindings to `0.0.0.0` — see Docker Bridge Binding Fix below |

#### Convenience scripts (system packages)

- **`nanoclaw-start`** — starts OneCLI gateway (`docker compose up -d` in `~/.onecli`) then starts the nanoclaw user service. Checks that the compose file exists and fails clearly if the OneCLI installer hasn't been run yet.
- **`nanoclaw-stop`** — stops nanoclaw first (flush in-flight messages), then brings down the gateway.
- **`ncl`** — thin wrapper that `exec`s `bin/ncl` at the project's absolute path. `bin/ncl` resolves symlinks on `$BASH_SOURCE[0]` to find `PROJECT_ROOT`, so passing the absolute path is sufficient — no `cd` needed in the wrapper.

---

## Docker Bridge Binding Fix

### Problem

`docker-compose.yml` uses `${ONECLI_BIND_HOST:-127.0.0.1}` for both port bindings and URL env vars. This means both OneCLI ports (10254 app, 10255 proxy) are bound only to `127.0.0.1` (loopback).

Docker containers reach the host via `172.17.0.1` (the Docker bridge) — a completely different network interface. The HTTPS credential proxy on port 10255 is therefore unreachable from inside agent containers:

```
Host loopback (127.0.0.1):
  :10254  ← nanoclaw host process connects here (works ✅)
  :10255  ← agent containers need this via 172.17.0.1 (FAILS ❌)

Docker bridge (172.17.0.1):
  (nothing bound here by default)
```

Symptom: `[poll-loop] Error: API retry (retryable: true)` repeating indefinitely in container logs. `wakeContainer failed: fetch failed` in `nanoclaw.error.log`.

### Fix

`~/.onecli/docker-compose.override.yml` (deployed by `nanoclaw.nix` via `systemd-tmpfiles`):

```yaml
services:
  onecli:
    ports:
      - "0.0.0.0:10254:10254"   # was 127.0.0.1:10254
      - "0.0.0.0:10255:10255"   # was 127.0.0.1:10255
    environment:
      APP_URL: http://127.0.0.1:10254      # explicit, not derived from ONECLI_BIND_HOST
      GATEWAY_API_URL: http://127.0.0.1:10255  # explicit, keeps web UI working
  postgres:
    ports:
      - "127.0.0.1:5432:5432"  # postgres stays on loopback
```

Docker Compose auto-merges `docker-compose.override.yml` with the base file. The file is deployed as a Nix-store symlink (`L+` rule) — updated on every `nixos-rebuild switch`.

### Why `APP_URL`/`GATEWAY_API_URL` are overridden separately

If `ONECLI_BIND_HOST=0.0.0.0` were set, `APP_URL` would become `http://0.0.0.0:10254`, which browsers can't connect to (0.0.0.0 is not a routable address). The override file sets them explicitly to `127.0.0.1` so the web UI at `http://127.0.0.1:10254` continues to work.

---

## Secrets — Two-File Approach

Nanoclaw reads config via two separate mechanisms, which determines where each variable must live:

### File 1: `<projectRoot>/.env` — read by `readEnvFile()` in `src/env.ts`

`readEnvFile()` parses the project root `.env` file **directly** and returns the requested keys. It does **not** populate `process.env`. Variables that nanoclaw reads this way must be in this file.

```bash
# <projectRoot>/.env
ONECLI_URL=http://127.0.0.1:10254   # explicit IPv4 — localhost resolves to [::1] on this system
ASSISTANT_NAME=Andy
TZ=Europe/Oslo
ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
```

Keys read via `readEnvFile()` in source:
- `src/config.ts`: `ASSISTANT_NAME`, `ONECLI_URL`, `ONECLI_API_KEY`, `TZ`
- `src/channels/slack.ts`: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`

### File 2: `~/.config/nanoclaw/secrets.env` — loaded by systemd into `process.env`

The systemd service's `EnvironmentFile` sets variables in `process.env` before the process starts. Variables that libraries read from `process.env` directly (not via nanoclaw's `readEnvFile`) must be here.

```bash
# ~/.config/nanoclaw/secrets.env
SLACK_APP_TOKEN=xapp-...
```

**Why `SLACK_APP_TOKEN` is here and not in `.env`:**  
`@chat-adapter/slack` uses socket mode. It reads `SLACK_APP_TOKEN` via `process.env.SLACK_APP_TOKEN` (see `dist/index.js:4262` in the package — `const appToken = config?.appToken ?? process.env.SLACK_APP_TOKEN`). `src/channels/slack.ts` does not pass it through `readEnvFile`, so it must arrive as a real environment variable. The systemd `EnvironmentFile` is the right place for this.

> ⚠️ The `EnvironmentFile` path has a leading `-` in the service config, meaning systemd will not fail if the file is absent. This lets the service start during initial setup before the file is created.

### Note on `ANTHROPIC_BASE_URL`

The project `.env` already contains `ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1`. This routes Claude Code (inside agent containers) to OpenRouter instead of directly to Anthropic. The OneCLI credential registration must therefore use `--host-pattern openrouter.ai` (not `api.anthropic.com`). See [OneCLI Post-Install Config](#onecli-post-install-config).

---

## One-Time Bootstrap

```bash
cd /home/mathipe/Prosjekter/Personal/Slackbot/nanoclaw_bot/nanoclaw

# 1. ✅ DONE — JS deps + compiles better-sqlite3 native module
# pnpm install --frozen-lockfile

# 2. ✅ DONE — Compile TypeScript → dist/
# pnpm run build

# 3. ✅ DONE — logs and data directories created by systemd-tmpfiles
# mkdir -p logs data

# 4. ✅ DONE — Agent Docker image built
# cd container && docker build -t nanoclaw-agent-v2-a72e394a:latest . && cd ..

# 5. ✅ DONE — OneCLI gateway installed
# curl -fsSL onecli.sh/install | sh
# NOTE: installer places files in ~/.onecli/, not /opt/onecli/

# 6. ✅ DONE — OneCLI CLI configured and OpenRouter credential registered
# onecli config set api-host http://127.0.0.1:10254
# onecli secrets create --name OpenRouter --type anthropic --value sk-or-v1-... --host-pattern openrouter.ai

# 7. ✅ DONE — Upgrade tripwire cleared (set after manual setup)
# pnpm exec tsx scripts/upgrade-state.ts set

# 8. ✅ DONE — Initial agent group seeded into SQLite
# pnpm exec tsx scripts/init-cli-agent.ts --display-name "Mathipe" --agent-name "Personal Assistant"

# 9. ✅ DONE — Slack channel wired
# pnpm exec tsx setup/register.ts --platform-id <slack-channel-id>

# 10. ⚠️ PENDING — Apply docker-compose.override.yml binding fix
#     After nixos-rebuild switch:
systemd-tmpfiles --create
cd ~/.onecli && docker compose down && docker compose up -d
nanoclaw-start
```

| Step | Why it can't be skipped |
|---|---|
| `pnpm install` ✅ | Compiles `better-sqlite3` native module. Without it `dist/index.js` crashes at startup. |
| `pnpm run build` ✅ | Produces `dist/` from `src/`. The systemd unit points at `dist/index.js`. |
| `mkdir -p logs data` ✅ | `StandardOutput = append:…/logs/nanoclaw.log` — systemd fails to start if the directory is missing. |
| `docker build` ✅ | Creates the image every agent session runs in. Tag **must** be `nanoclaw-agent-v2-<slug>:latest` — derived from project path in `src/config.ts`. |
| OneCLI installer ✅ | Produces `~/.onecli/docker-compose.yml` which `nanoclaw-start` expects. |
| `onecli secrets create` ✅ | `src/container-runner.ts` calls `onecli.applyContainerConfig()` before every `docker run`. Without a registered credential it throws, and no containers will ever spawn. |
| `upgrade-state.ts set` ✅ | Clears the tripwire that prevents starting if nanoclaw wasn't installed via `setup:auto`. |
| `init-cli-agent.ts` ✅ | Seeds `agent_groups` and related tables in `data/v2.db`. Without it the router has no group to route messages to and drops everything silently. |
| `setup/register.ts` ✅ | Wires the Slack channel to the agent group in the database. |
| `docker-compose.override.yml` ⚠️ | Fixes port bindings so agent containers can reach the OneCLI proxy. Without it: API retry loop. |

---

## OneCLI — Post-Install Config

After the gateway is running and `onecli` is on PATH (it is after `nixos-rebuild switch` since the derivation is in `ai-tools.nix`):

```bash
# 1. Point the CLI at the gateway (✅ DONE)
# Use 127.0.0.1 explicitly — localhost resolves to [::1] (IPv6) on this system,
# which is not listening. The gateway only listens on IPv4.
onecli config set api-host http://127.0.0.1:10254

# 2. Register the OpenRouter credential (✅ DONE)
# host-pattern must be openrouter.ai because ANTHROPIC_BASE_URL in .env
# points Claude Code at https://openrouter.ai/api/v1.
# OneCLI intercepts HTTPS traffic to that host and injects the Authorization header.
onecli secrets create \
  --name OpenRouter \
  --type anthropic \
  --value sk-or-v1-... \
  --host-pattern openrouter.ai
```

**Why this matters:** `src/container-runner.ts` calls `onecli.applyContainerConfig()` before every `docker run`. This injects `HTTPS_PROXY` + certificates so container API calls route through the gateway, which adds the `Authorization` header at the proxy level. The container never holds the API key directly. If no credential is registered, `applyContainerConfig()` throws and no containers will ever spawn.

**Two separate connection paths:**
- **Host → gateway (port 10254):** nanoclaw host process uses `ONECLI_URL=http://127.0.0.1:10254` to register/wake containers. Loopback works fine here.
- **Container → proxy (port 10255):** agent containers use `HTTPS_PROXY=http://...@host.docker.internal:10255`. `host.docker.internal` resolves to `172.17.0.1` (Docker bridge). This requires the proxy to be bound to `0.0.0.0` — handled by `docker-compose.override.yml`.

---

## Quick Reference

| Piece | Where | Status |
|---|---|---|
| `virtualisation.docker.enable` | `hosts/default/config.nix` | ✅ Done |
| User in `docker` group | `hosts/default/users.nix` | ✅ Done |
| User lingering | N/A | ✅ Not needed (always logged in or machine is off) |
| OneCLI gateway systemd service | N/A | ✅ Not needed (manual via `nanoclaw-start`) |
| OneCLI CLI derivation | `modules/packages/ai-tools.nix` | ✅ Done |
| `nanoclaw-v2-a72e394a` systemd user unit | `modules/services/nanoclaw.nix` | ✅ Done |
| `~/.config/nanoclaw/mount-allowlist.json` | `modules/services/nanoclaw.nix` (tmpfiles) | ✅ Done |
| `logs/` and `data/` directories | `modules/services/nanoclaw.nix` (tmpfiles) | ✅ Done |
| `nanoclaw-start` / `nanoclaw-stop` / `ncl` | `modules/services/nanoclaw.nix` | ✅ Done |
| `~/.onecli/docker-compose.override.yml` symlink | `modules/services/nanoclaw.nix` (tmpfiles `L+`) | ⚠️ Declared; apply after next rebuild |
| `pnpm install` + `pnpm run build` | Run once in project dir | ✅ Done |
| OneCLI installer (`curl \| sh`) | Run once — installs to `~/.onecli/` | ✅ Done |
| `onecli config set api-host http://127.0.0.1:10254` | Run once | ✅ Done |
| `onecli secrets create` (OpenRouter) | Run once | ✅ Done |
| `docker build -t nanoclaw-agent-v2-a72e394a:latest` | Run once in `container/` | ✅ Done |
| `tsx scripts/upgrade-state.ts set` | Run once after manual setup | ✅ Done |
| `tsx scripts/init-cli-agent.ts` | Run once in project dir | ✅ Done |
| `<projectRoot>/.env` | Manual file in project root | ✅ Done |
| `~/.config/nanoclaw/secrets.env` | Manual file with `SLACK_APP_TOKEN` | ✅ Done |
| `setup/register.ts --platform-id <id>` | Run once per channel | ✅ Done |
| Apply docker-compose.override.yml + restart gateway | After next `nixos-rebuild switch` | ⚠️ Pending |

### Install slug

```
Path:    /home/mathipe/Prosjekter/Personal/Slackbot/nanoclaw_bot/nanoclaw
Slug:    a72e394a
Service: nanoclaw-v2-a72e394a
Image:   nanoclaw-agent-v2-a72e394a:latest
```

---

## Related

- [[Clients/Personal/AgentNotes/Reference/NanoClaw/NanoClaw Operations]] — quick-reference runbook (start/stop, logs, common fixes)
- [[Clients/Personal/AgentNotes/Reference/Slackbot/_Index]] — old Python/Ollama bot (superseded)
- [NanoClaw GitHub](https://github.com/nanocoai/nanoclaw)
- [OneCLI](https://onecli.sh)
- [NixOS Wiki — Docker](https://wiki.nixos.org/wiki/Docker)
- [NixOS Wiki — Systemd user services](https://wiki.nixos.org/wiki/Systemd/User_services)
