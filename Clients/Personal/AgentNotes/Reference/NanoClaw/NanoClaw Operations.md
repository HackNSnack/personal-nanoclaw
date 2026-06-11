---
tags:
  - nanoclaw
  - ops
  - runbook
type: reference
status: active
---

# NanoClaw Operations — Quick Reference

Project root: `~/Prosjekter/Personal/Slackbot/nanoclaw_bot/nanoclaw`  
All `pnpm exec` commands run from there unless noted.

---

## Start / Stop

```bash
nanoclaw-start   # OneCLI gateway up → nanoclaw service start
nanoclaw-stop    # nanoclaw service stop → OneCLI gateway down
```

Manual equivalents if the scripts fail:
```bash
# Start
cd ~/.onecli && docker compose up -d
systemctl --user start nanoclaw-v2-a72e394a

# Stop
systemctl --user stop nanoclaw-v2-a72e394a
cd ~/.onecli && docker compose down
```

---

## Logs

```bash
# Live service log (stdout)
tail -f ~/Prosjekter/Personal/Slackbot/nanoclaw_bot/nanoclaw/logs/nanoclaw.log

# Live error log (stderr) — most useful for crash diagnosis
tail -f ~/Prosjekter/Personal/Slackbot/nanoclaw_bot/nanoclaw/logs/nanoclaw.error.log

# systemd journal (start/stop/crash events, not app output)
journalctl --user -fu nanoclaw-v2-a72e394a

# Last 100 lines of error log
tail -100 ~/Prosjekter/Personal/Slackbot/nanoclaw_bot/nanoclaw/logs/nanoclaw.error.log
```

---

## Service Status

```bash
systemctl --user status nanoclaw-v2-a72e394a

# OneCLI gateway
docker ps | grep onecli
```

---

## Common Fixes

### Upgrade tripwire — service refuses to start, error: "install not on sanctioned path"

Happens when nanoclaw was set up manually (bypassing `pnpm run setup:auto`) or cloned without running the setup wizard.

```bash
systemctl --user stop nanoclaw-v2-a72e394a
cd ~/Prosjekter/Personal/Slackbot/nanoclaw_bot/nanoclaw
pnpm exec tsx scripts/upgrade-state.ts set
nanoclaw-start
```

### Node version mismatch — `better-sqlite3` crash on startup

Happens after a nixpkgs update bumps the Node major version.

```bash
systemctl --user stop nanoclaw-v2-a72e394a
cd ~/Prosjekter/Personal/Slackbot/nanoclaw_bot/nanoclaw
pnpm install --frozen-lockfile   # recompiles better-sqlite3 for new Node
nanoclaw-start
```

### Circuit breaker — service keeps restarting with increasing delays

Nanoclaw backs off exponentially after repeated crashes (5s → 30s → 120s → 300s...).
Stop the loop, fix the underlying issue, then restart cleanly.

```bash
systemctl --user stop nanoclaw-v2-a72e394a
# ... fix whatever is in nanoclaw.error.log ...
nanoclaw-start
```

### `Error: Model not found: <model-id>` — agent returns error on every message

**Symptom:** Bot replies with `Error: Model not found: openrouter/deepseek/deepseek-v4-pro` (or similar). No actual agent output.

Three possible root causes (may stack):

**A — Model not in OpenCode's bundled registry** (most common for new models)
OpenCode v1.4.17 only knows DeepSeek up to v3.2. Models released after the binary was built throw `ProviderModelNotFoundError` before any API call. The fix is already in `buildOpenCodeConfig()` — it auto-registers any `OPENCODE_MODEL` value in the provider's `models:` block, bypassing the bundled-list check.

**B — Missing `openrouter/` prefix in `OPENCODE_MODEL`**
OpenCode parses the model ID as `provider/model`. Without the prefix, `deepseek/deepseek-v4-pro` is read as provider=`deepseek`, not provider=`openrouter`.
Fix: ensure `.env` has `OPENCODE_MODEL=openrouter/deepseek/deepseek-v4-pro`.

**C — Stale session continuation in outbound.db** (error on every restart)
If a previous session was broken, the poll-loop tries to resume it and hits the error again. `STALE_SESSION_RE` now catches both `model not found` and `ProviderModelNotFoundError` and clears the continuation automatically. If it keeps recurring, clear manually:

```bash
sqlite3 data/v2-sessions/<group>/<session>/outbound.db \
  "DELETE FROM session_state WHERE key = 'continuation:opencode';"
```

Full diagnostic: [[Clients/Personal/AgentNotes/Reference/NanoClaw/OpenCode ProviderModelNotFoundError — Stale Session Loop]]
Architecture + config reference: [[Clients/Personal/AgentNotes/Reference/NanoClaw/OpenCode + OpenRouter Configuration]]

---

### OneCLI connection refused — `dial tcp [::1]:10254: connect: connection refused`

Two possible causes:
1. Gateway not running: `cd ~/.onecli && docker compose up -d`
2. Wrong host configured (`localhost` resolves to IPv6 `[::1]` but gateway only listens on IPv4)

```bash
onecli config set api-host http://127.0.0.1:10254
# Also update ONECLI_URL in .env to http://127.0.0.1:10254
# Always use 127.0.0.1 explicitly — localhost resolves to [::1] on this system
```

### Agent containers cannot reach OneCLI proxy — `wakeContainer failed: fetch failed` / API retry loop

**Root cause:** `docker-compose.yml` binds ports to `127.0.0.1` (loopback) by default. Docker containers reach the host via `172.17.0.1` (the Docker bridge) — a completely different network interface. The HTTPS credential proxy on port 10255 is unreachable from inside containers when bound only to loopback.

Diagnose:

```bash
# Check what interface the ports are bound to on the host
ss -tlnp | grep -E '10254|10255'
# Before fix: 127.0.0.1:10254 / 127.0.0.1:10255
# After fix:    0.0.0.0:10254 /   0.0.0.0:10255

# Test reachability from inside a running agent container
docker exec <container-name> sh -c \
  'getent hosts host.docker.internal && curl -sv --max-time 3 http://host.docker.internal:10255 2>&1 | tail -5'
# "000" or timeout = binding problem
```

**Fix:** `~/.onecli/docker-compose.override.yml` is managed by `nanoclaw.nix` and deployed as a Nix-store symlink via `systemd-tmpfiles`. It overrides the port bindings to `0.0.0.0` (all interfaces) while keeping `APP_URL`/`GATEWAY_API_URL` as `127.0.0.1` so the web UI continues to work. Docker Compose auto-merges the override file with the base `docker-compose.yml`.

```bash
# 1. Verify the override symlink is deployed (should point into /nix/store)
ls -la ~/.onecli/docker-compose.override.yml

# If missing (before first nixos-rebuild switch that includes the fix):
systemd-tmpfiles --create

# 2. Recreate gateway containers to pick up the new port bindings
cd ~/.onecli && docker compose down && docker compose up -d

# 3. Confirm 172.17.0.1 is now reachable from the host
curl -s --max-time 2 http://172.17.0.1:10254   # should return the OneCLI HTML page
curl -s --max-time 2 http://172.17.0.1:10255   # should connect (any non-timeout response)
```

> ⚠️ After every `nixos-rebuild switch`: run `systemd-tmpfiles --create` (or reboot), then `docker compose down && docker compose up -d` to recreate containers with the updated bindings.

### OneCLI gateway not starting / compose file not found

```bash
# Installer puts files in ~/.onecli/, not /opt/onecli/
ls ~/.onecli/

# Restart gateway manually
cd ~/.onecli && docker compose down && docker compose up -d
```

---

## Database

```bash
# Seed initial agent group (run once, or after wiping data/)
cd ~/Prosjekter/Personal/Slackbot/nanoclaw_bot/nanoclaw
pnpm exec tsx scripts/init-cli-agent.ts \
  --display-name "Mathipe" \
  --agent-name "Personal Assistant"

# Inspect the DB directly
sqlite3 data/v2.db .tables
sqlite3 data/v2.db 'SELECT * FROM agent_groups;'
```

---

## Docker Image

```bash
# Check image exists
docker images nanoclaw-agent-v2-a72e394a

# Rebuild (needed after Dockerfile changes or first setup)
cd ~/Prosjekter/Personal/Slackbot/nanoclaw_bot/nanoclaw/container
docker build -t nanoclaw-agent-v2-a72e394a:latest .
```

---

## Ollama / OpenRouter Switching

Switching is per agent group. Find the group ID with `ncl groups list`.

```bash
# Switch to local Ollama
ncl groups update <group-id> --provider ollama
ncl groups update <group-id> --model gemma4:latest   # exact name from `ollama list`

# Revert to Claude via OpenRouter
ncl groups update <group-id> --provider claude
ncl groups update <group-id> --model claude-sonnet-4-5

# Ollama must be running on the host first
ollama serve
```

---

## Slack Channel Wiring

Channels are registered via the channel-approval flow the first time the bot is tagged. The flow creates both the wiring (`messaging_group_agents`) and the destination routing entry (`agent_destinations`) automatically.

### Standard flow (automatic)

1. Tag the bot (`@BotName`) in the Slack channel.
2. The router auto-creates a `messaging_groups` row and fires the channel-registration gate.
3. Approve via CLI: `ncl pending-channel-approvals list` then `ncl pending-channel-approvals approve --id <id>`
   — or use `./scripts/wire-slack.sh` which does the approval and open-policy steps in one go.
4. Open to all senders (default policy blocks unknown users):
   ```bash
   ncl messaging-groups update --id <mg-id> --unknown-sender-policy public
   sqlite3 data/v2.db "DELETE FROM pending_sender_approvals"
   ```
5. Re-send the original message — bot should respond.

### Why both wiring AND destination must exist

Creating a wiring (`messaging_group_agents` row) is not enough on its own. The agent also needs an `agent_destinations` row — this is the named routing entry the agent uses in `<message to="name">` replies. Without it, the agent sees no destinations and the reply is dropped as `unknown destination`.

`createMessagingGroupAgent()` creates both rows. The `ncl wirings create` command now also goes through this function (fixed 2026-06-11 — previously it used a raw INSERT that skipped destination creation).

### Verifying a wiring is complete

```bash
# Both of these should return a row for the Slack channel:
sqlite3 data/v2.db "SELECT * FROM messaging_group_agents WHERE messaging_group_id LIKE 'mg-%';"
sqlite3 data/v2.db "SELECT * FROM agent_destinations WHERE target_type='channel';"

# The session inbound.db should list the destination:
LATEST=$(ls -td data/v2-sessions/ag-*/sess-*/inbound.db | head -1)
sqlite3 "$LATEST" "SELECT name, channel_type, platform_id FROM destinations;"
# Expected: slack|slack|slack:C05H4P5P8EA
```

If `agent_destinations` is missing a row, see manual repair steps in [[Clients/Personal/AgentNotes/Reference/NanoClaw/Slack Channel Setup & Debugging]].

> ⚠️ Wirings and destinations live in `data/v2.db` — not portable across machines. See [[Clients/Personal/AgentNotes/Reference/NanoClaw/Slack Channel Setup & Debugging]] for the full new-machine checklist.

---

## OneCLI Secrets

```bash
# List registered credentials
onecli secrets list

# Register OpenRouter credential
onecli secrets create \
  --name OpenRouter \
  --type anthropic \
  --value sk-or-v1-... \
  --host-pattern openrouter.ai

# Delete a credential
onecli secrets delete --name OpenRouter
```

---

## After nixos-rebuild switch

```bash
# If Node major version changed — recompile better-sqlite3
cd ~/Prosjekter/Personal/Slackbot/nanoclaw_bot/nanoclaw && pnpm install --frozen-lockfile

# Reload systemd user unit definitions (if service unit changed)
systemctl --user daemon-reload

# Deploy updated Nix-managed files (e.g. docker-compose.override.yml symlink)
systemd-tmpfiles --create

# If compose override changed — recreate gateway containers
cd ~/.onecli && docker compose down && docker compose up -d
```

---

## Related

- [[Clients/Personal/AgentNotes/Reference/NanoClaw/NanoClaw NixOS Setup]] — full setup reference and bootstrap checklist
- NixOS config: `~/NixOS-Hyprland/modules/services/nanoclaw.nix`
- Nanoclaw repo: `~/Prosjekter/Personal/Slackbot/nanoclaw_bot/nanoclaw`
