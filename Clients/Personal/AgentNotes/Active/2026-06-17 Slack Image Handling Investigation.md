---
tags: [nanoclaw, slack, image-handling, investigation, debugging]
type: investigation
status: archived
date: 2026-06-17
---

# 2026-06-17 Slack Image Handling Investigation

> [!warning] SUPERSEDED 2026-06-30. The conclusion below ("images are not supported — known
> limitation") is no longer true. Image handling was built and fixed; a Slack image is now read
> by the model. See [[Clients/Personal/AgentNotes/Reference/NanoClaw/Slack Image Handling — Pipeline, OpenRouter Vision & Debugging]]. Kept for history.

**Request:** Mathias sent image.png via Slack and asked "can you read this image?"

**Result:** Confirmed a known NanoClaw Slack limitation — file attachments are not processed by the agent. The image data never reaches the agent's environment.

---

## What We Know About the Image

From the message metadata stored in `inbound.db`:

| Field | Value |
|---|---|
| Filename | `image.png` |
| MIME type | `image/png` |
| Size | 850,080 bytes (~830 KB) |
| Dimensions | 641 × 801 pixels |
| Channel | `C05H4P5P8EA` |
| Timestamp | `2026-06-17T16:19:58.885Z` |
| Message ID | `1781713198.885529` |

The image is an 830 KB PNG, portrait orientation (taller than wide), 641×801px.

---

## Investigation Steps Attempted

### Step 1: Search local filesystem for the image

All standard locations were searched:
- `workspace/agent/` — 33 files, no image.png
- `workspace/group/` — empty directory
- `/tmp/` — no PNG files beyond a wasm binary
- `/var/tmp/` — no relevant files
- Glob search for `image.png` across entire filesystem — not found
- Glob search for any PNG across workspace (excluding node_modules, .pnpm-store, assets, Obsidian Images) — none found
- `find` with `-newer` flag to find recently created image files — none found
- Search for PNG header bytes (`\x89PNG...`) in `inbound.db` — not found

**Finding:** The image data is not stored anywhere in the agent's filesystem or databases.

### Step 2: Analyze `inbound.db` (SQLite database)

The agent's inbound message database stores only JSON metadata, not binary attachments.

**Schema of `messages_in` table:**
```sql
CREATE TABLE messages_in (
  id             TEXT PRIMARY KEY,
  seq            INTEGER UNIQUE,
  kind           TEXT NOT NULL,
  timestamp      TEXT NOT NULL,
  status         TEXT DEFAULT 'pending',
  process_after  TEXT,
  recurrence     TEXT,
  series_id      TEXT,
  tries          INTEGER DEFAULT 0,
  trigger        INTEGER NOT NULL DEFAULT 1
);
```

The message JSON is stored as the `id` field value. Extracted message:

```json
{
  "_type": "chat:Message",
  "id": "1781713198.885529",
  "threadId": "slack:C05H4P5P8EA:1781713198.885529",
  "text": "@U0B7Y3QHZSQ can you read this image?",
  "formatted": { ... },
  "author": {
    "userId": "U05GWSRMV7Z",
    "userName": "Mathias (cool guy)",
    "fullName": "Mathias (cool guy)"
  },
  "metadata": {
    "dateSent": "2026-06-17T16:19:58.885Z",
    "edited": false
  },
  "attachments": [
    {
      "type": "image",
      "name": "image.png",
      "mimeType": "image/png",
      "size": 850080,
      "width": 641,
      "height": 801
    }
  ],
  "isMention": true,
  "senderId": "U05GWSRMV7Z",
  "sender": "Mathias (cool guy)",
  "senderName": "Mathias (cool guy)"
}
```

The `attachments` array only carries metadata (type, name, mimeType, size, dimensions). There is:
- No `data` field
- No `data_base64` field
- No `url` or file download URL
- No binary blob stored in the DB

**Other databases checked:**
- `outbound.db` — contains outbound message routing data only (agent_destinations table), no image data

### Step 3: Attempt Slack API access through OneCLI Gateway

The environment has a OneCLI gateway proxy configured:
- `HTTPS_PROXY=http://x:aoc_<token>@host.docker.internal:10255`

Three attempts were made:

| Attempt | Method | Result |
|---|---|---|
| `curl` with explicit Bearer token + proxy | `-H "Authorization: Bearer placeholder"` through proxy at `127.0.0.1:8111` | Connection refused (proxy not at 127.0.0.1:8111) |
| `curl` without auth header (relying on gateway auto-injection) | `https://slack.com/api/conversations.history?channel=C05H4P5P8EA&latest=1781713198.885529&limit=1&inclusive=true` | `{"ok":false,"error":"not_authed"}` |
| `curl` with explicit Bearer + system proxy | Same URL but with `-H "Authorization: Bearer placeholder"` | `{"ok":false,"error":"invalid_auth"}` |

**Finding:** The OneCLI gateway does not have Slack credentials configured for this agent. GitHub works fine (confirmed: responded with HackNSnack user data), so the gateway itself is operational.

The gateway error response did not contain a `connect_url` field — the `not_authed` response from Slack's API is just a simple JSON error, not a gateway-injected connect prompt.

### Step 4: Check agent group config

```
ncl groups config get → ag-1781098614662-lx2src
```

No Slack-specific configuration or credentials are present in the agent group's config.

---

## Root Cause: Known NanoClaw Limitation

From the NanoClaw documentation:

> **Known limitations:**
> - ...
> - **No file or image handling** — file attachments in Slack messages are not currently processed by the agent.

This is documented in the Slack integration docs. The Slack adapter relays the text of messages to the agent but strips file attachments (or passes only metadata). The binary content never reaches the agent's environment.

---

## What Would Need to Change to Fix This

To enable image handling, NanoClaw would need:

1. **Slack adapter enhancement** — When a message has file attachments, the adapter needs to:
   - Download the file using `files.info` Slack API (requires `files:read` OAuth scope)
   - Store the file data in the inbound message payload (e.g., as base64 in a `data` field on the attachment)
   - OR store it to a shared filesystem path and pass the path in the message

2. **Gateway credential** — The OneCLI gateway needs Slack bot token credentials configured so the agent can call Slack's `files.info` API

3. **OAuth scope** — The Slack app needs `files:read` scope in addition to the current scopes:
   ```
   app_mentions:read, chat:write, reactions:write, commands, channels:history, im:history
   ```
   (currently missing `users:read` as well)

4. **Inbound message schema** — The `messages_in` table or the message JSON format would need to accommodate binary attachment data

---

## Related

- [[Slack Channel Setup & Debugging]] — full Slack integration setup docs
- [[MEMORY]] — agent metadata and workspace reference
- [[NanoClaw Operations]] — general operations and common fixes
