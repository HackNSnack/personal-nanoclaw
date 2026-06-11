---
tags: [nanoclaw, slack, debugging, ops]
type: reference
status: active
---

# Slack Channel Setup & Debugging

Documents the full setup process for Slack in NanoClaw v2, and the three-layer failure that was diagnosed and fixed on 2026-06-11.

---

## How Slack Connection Works

NanoClaw supports two Slack connection modes:

| Mode | How | Requires |
|---|---|---|
| **Socket Mode** | Outbound WebSocket from your server to Slack | `SLACK_APP_TOKEN` (`xapp-…`) in `process.env` |
| **Webhook mode** | Slack POSTs events to your server's URL | Public URL + `SLACK_SIGNING_SECRET` |

**This installation uses Socket Mode.** The machine has no public IPv4 (private LAN `192.168.10.168` behind NAT), so webhook mode does not work. `SLACK_APP_TOKEN` is loaded into `process.env` via the systemd `EnvironmentFile` (`~/.config/nanoclaw/secrets.env`).

The adapter auto-selects mode based on whether `process.env.SLACK_APP_TOKEN` is set — see `src/channels/slack.ts`:

```typescript
const appToken = process.env.SLACK_APP_TOKEN;
const slackAdapter = appToken
  ? createSlackAdapter({ botToken: env.SLACK_BOT_TOKEN, mode: 'socket', appToken })
  : createSlackAdapter({ botToken: env.SLACK_BOT_TOKEN, signingSecret: env.SLACK_SIGNING_SECRET });
```

Confirm Socket Mode is active in logs:
```
[chat-sdk:slack] Slack socket mode connected
```

---

## Three-Layer Failure (2026-06-11)

The bot was completely unresponsive to Slack messages. Three independent problems stacked:

### Layer 1 — Wrong connection mode

**Symptom:** No Slack events ever reached the bot. `dropped_messages` table empty. No Slack-related entries in `nanoclaw.log` beyond startup.

**Root cause:** `src/channels/slack.ts` defaulted to webhook mode. `SLACK_APP_TOKEN` was in `process.env` (loaded from `secrets.env` by systemd) but was never passed to `createSlackAdapter`. The webhook server on port 3000 was listening but unreachable from Slack's servers (machine behind NAT).

**Fix:** Updated `slack.ts` to detect `process.env.SLACK_APP_TOKEN` and select socket mode automatically.

---

### Layer 2 — No channel wiring

**Symptom:** After the socket mode fix, messages arrived but were dropped:
```
Auto-created messaging group  id="mg-…"  channelType="slack"
Channel registration card delivered  approver="cli:local"
```
No `Message routed` entry followed.

**Root cause:** No `messaging_group_agents` row existed for the Slack channel. The router auto-creates a `messaging_groups` row on first mention, but with zero wirings it calls the channel-registration gate. The gate tried to send an approval card to an owner — but `user_roles` was empty (no owner configured), so it silently dropped the message.

**Fix:**
1. Granted `cli:local` the `owner` role so the approval gate has an approver:
   ```bash
   ./bin/ncl roles grant --user cli:local --role owner
   ```
2. After the first Slack message auto-created the messaging group, wired it:
   ```bash
   ./scripts/wire-slack.sh   # see scripts/wire-slack.sh in project root
   ```

---

### Layer 3 — Unknown sender policy

**Symptom:** After the wiring was in place, messages were still dropped:
```
MESSAGE DROPPED — unknown sender (approval requested)
userId="slack:U05GWSRMV7Z"  accessReason="not_member"
```

**Root cause:** Auto-created messaging groups default to `unknown_sender_policy='request_approval'`. Any Slack user not explicitly added as a member of the agent group triggers a sender-approval flow. For a multi-user channel this means every new person who tags the bot gets silently blocked.

**Fix:** Set the Slack messaging group policy to `public`:
```bash
./bin/ncl messaging-groups update --id <mg-id> --unknown-sender-policy public
sqlite3 data/v2.db "DELETE FROM pending_sender_approvals"
```

Verify:
```bash
sqlite3 data/v2.db "SELECT channel_type, unknown_sender_policy FROM messaging_groups WHERE channel_type='slack'"
# → slack|public
```

---

## Required Slack App Scopes

Current working scopes:
```
app_mentions:read, chat:write, reactions:write, commands, channels:history, im:history
```

Missing (non-fatal but logged as error):
- **`users:read`** — needed to look up sender display names. Without it, the adapter logs `Could not fetch user info: missing_scope` for every message. Messages still route correctly; sender name just won't be populated.

To add: **api.slack.com/apps → OAuth & Permissions → Bot Token Scopes → add `users:read` → Reinstall to workspace**. Existing tokens remain valid; no other config changes needed.

---

## Setting Up a New Slack Channel

When the bot is tagged in a channel it has never seen before:

1. The router auto-creates a `messaging_groups` row.
2. The channel-registration gate fires and sends an approval card to `cli:local` (the owner).
3. The card is a `pending_channel_approvals` row in the DB — but since CLI doesn't support interactive button clicks, bypass it:

```bash
# Wire the new channel to Personal Assistant
./scripts/wire-slack.sh

# If it was already wired but sender is blocked:
./bin/ncl messaging-groups update --id <mg-id> --unknown-sender-policy public
sqlite3 data/v2.db "DELETE FROM pending_sender_approvals"
```

Then have the user re-send their message.

---

## Portability — Running on Another Machine

> ⚠️ **The database is not portable.** Channel wirings and sender policies live in `data/v2.db` and are not re-created automatically on a fresh install.

### What is portable (in source / config files)

| What | Where | Notes |
|---|---|---|
| Socket mode adapter code | `src/channels/slack.ts` | Auto-selects mode from `process.env` |
| Bot token + signing secret | `<project>/.env` | Copy `.env` to new machine |
| App token | `~/.config/nanoclaw/secrets.env` | Must be recreated on new machine — not in repo |

### What is NOT portable (lives only in `data/v2.db`)

| What | DB table | How to recreate |
|---|---|---|
| Slack channel → agent wiring | `messaging_group_agents` | `./scripts/wire-slack.sh` after first tag |
| `unknown_sender_policy=public` | `messaging_groups` | `ncl messaging-groups update --unknown-sender-policy public` |
| Owner role for `cli:local` | `user_roles` | `ncl roles grant --user cli:local --role owner` |
| Agent group definition | `agent_groups` | `pnpm exec tsx scripts/init-cli-agent.ts …` |
| All conversation history | `data/v2-sessions/` | Copy directory or start fresh |

### Steps on a fresh machine

1. Complete the normal bootstrap (see [[NanoClaw NixOS Setup]]).
2. Ensure `~/.config/nanoclaw/secrets.env` contains `SLACK_APP_TOKEN=xapp-…`.
3. Start the service. Confirm: `[chat-sdk:slack] Slack socket mode connected` in logs.
4. Grant owner role: `./bin/ncl roles grant --user cli:local --role owner`
5. Tag the bot in Slack once. The messaging group is auto-created.
6. Wire it: `./scripts/wire-slack.sh`
7. Open the channel: `./bin/ncl messaging-groups update --id <mg-id> --unknown-sender-policy public`
8. Re-send the original message.

> **If `SLACK_APP_TOKEN` isn't in `process.env`** (e.g. non-NixOS machine without the `EnvironmentFile` systemd config), add it to `.env` and update `slack.ts` to read it via `readEnvFile` instead of `process.env.SLACK_APP_TOKEN`.

---

## Key DB IDs (this machine)

| What | Value |
|---|---|
| Slack messaging group | `mg-1781174529724-07htsd` |
| Slack channel platform ID | `slack:C05H4P5P8EA` |
| Agent group | `ag-1781098614662-lx2src` (Personal Assistant) |
| Wiring | `25be376c-48d7-4951-a34e-29040bbbcdc3` |

## Layer 4 — `agent_destinations` not populated (2026-06-11)

**Symptom:** Bot receives the message and generates a reply, but the reply is dropped:
```
[poll-loop] Unknown destination in <message to="unknown:slack:slack:C05H4P5P8EA">, dropping block
[poll-loop] WARNING: agent output had no <message to="..."> blocks — nothing was sent
```

**Root cause:** The agent's destination routing table (`agent_destinations` in `v2.db`) was missing the Slack channel. The system prompt told the agent no destinations were configured, so it echoed `unknown:slack:…` back as the reply-to destination — which the poll-loop rejected as unknown.

Two things contributed:

**1. `wirings-create` CLI used the generic CRUD handler**, which does a raw `INSERT INTO messaging_group_agents` and bypasses `createMessagingGroupAgent()`. The `createMessagingGroupAgent()` function is the one that also auto-creates the `agent_destinations` row. Any wiring created via `ncl wirings create` (rather than the channel-approval flow) would silently skip destination creation. Tell-tale signs in the DB: the wiring row has a UUID-format `id`, `sender_scope=all`, `ignored_message_policy=drop`.

**2. Fix applied to `src/cli/resources/wirings.ts`:** The generic CRUD `create` and `delete` were replaced with custom handlers:
- `create`: calls `createMessagingGroupAgent()` (creates both the wiring AND the `agent_destinations` row) + `projectDestinationsToSessions()` to update running containers immediately.
- `delete`: removes wiring row + `agent_destinations` row + re-projects.

From now on, creating a wiring via any path always populates `agent_destinations` correctly.

### How destinations flow to the agent

```
createMessagingGroupAgent()
  → INSERT INTO messaging_group_agents   (wiring)
  → INSERT INTO agent_destinations       (local name)
      local_name = normalised channel name ('slack', 'slack-2' for collisions)
      target_id  = messaging_groups.id

At every container spawn → writeDestinations()
  → SELECT agent_destinations JOIN messaging_groups
  → REPLACE INTO inbound.db/destinations
      name = local_name   ← agent uses this in <message to="name">

At wiring create/delete → projectDestinationsToSessions()
  → writeDestinations() for every active session immediately
```

### Manual repair (old installs / migrating machines)

If a wiring exists in `messaging_group_agents` but `agent_destinations` is missing the row:

```bash
# 1. Get IDs
sqlite3 data/v2.db "SELECT id, channel_type, platform_id FROM messaging_groups WHERE channel_type='slack';"
sqlite3 data/v2.db "SELECT id FROM agent_groups;"

# 2. Insert missing destination + set display name
sqlite3 data/v2.db "
INSERT INTO agent_destinations (agent_group_id, local_name, target_type, target_id, created_at)
VALUES ('ag-XXXX', 'slack', 'channel', 'mg-XXXX', datetime('now'));
UPDATE messaging_groups SET name = 'Slack' WHERE id = 'mg-XXXX';
"

# 3. Project into active sessions (no restart needed)
node -e "
const { initDb } = require('./dist/db/connection.js');
initDb('./data/v2.db');
const { getSessionsByAgentGroup } = require('./dist/db/sessions.js');
const { writeDestinations } = require('./dist/modules/agent-to-agent/write-destinations.js');
const id = 'ag-XXXX';
for (const s of getSessionsByAgentGroup(id)) { writeDestinations(id, s.id); console.log('projected', s.id); }
" 2>&1 | grep -v INFO
```


---

## Related

- [[Clients/Personal/AgentNotes/Reference/NanoClaw/NanoClaw Operations]] — start/stop, common fixes
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/NanoClaw NixOS Setup]] — full bootstrap checklist and secrets layout
