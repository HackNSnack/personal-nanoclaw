---
tags: [nanoclaw, slack, image-handling, vision, opencode, openrouter, mcp, debugging, reference]
type: reference
status: active
---

# Slack Image Handling — Pipeline, OpenRouter Vision & Debugging

**Status (2026-06-30): WORKING.** A Slack image tagged at the bot is now read by the model.
The last blocker was the OpenRouter **provider endpoint**, not nanoclaw code.

This is the single source of truth for how image input flows through NanoClaw, every
bug that broke it, the current config, and exactly how to debug it again — including
the **OpenRouter MCP server** and how to test individual providers.

Supersedes the point-in-time note [[Clients/Personal/AgentNotes/Active/2026-06-17 Slack Image Handling Investigation]] (which concluded, wrongly for the current build, that images are unsupported).
Companion: [[Clients/Personal/AgentNotes/Reference/NanoClaw/Mistral Vision Images & System Prompt — OpenCode Provider Fixes]].

---

## TL;DR

Three layered bugs had to be fixed, in order, for a Slack image to reach the model:

| # | Layer | Bug | Fix | Where |
|---|---|---|---|---|
| 1 | Model declaration | New model declared via `provider.models` drops modality metadata → OpenCode treats it text-only and strips image parts | Declare `modalities: { input: ['text','image'] }` | `opencode.ts buildOpenCodeConfig()` |
| 2 | Prompt assembly | Runtime instructions folded into user turn as `<system>` XML → Mistral echoes it, reply unwrapped/undelivered | Send via `promptAsync` `body.system` | `opencode.ts` |
| 3 | **Image part transport** | Image attached as a **`file://` URL** → OpenCode treats it as a *resource_link* (a reference), never inlines the bytes. Model only sees a text hint, calls `Read`, gets the image as a **tool result** — a position Mistral won't vision-process → "I can't read images" | Read the file and inline it as a **base64 `data:` URL** | `opencode.ts` fileParts loop |
| 4 | **Provider endpoint** | Even with the image correctly inlined, OpenRouter routed to **DeepInfra fp8**, which *accepted* the image (`num_media_prompt:1`, HTTP 200) but **did not apply the vision tower** → still refused | Pin a vision-working provider (Mistral first-party) via `OPENCODE_OPENROUTER_ROUTING` | `~/.config/nanoclaw/secrets.env` |

Bugs 1 & 2: documented in the companion note (applied 2026-06-30 AM).
Bugs 3 & 4: this note (applied 2026-06-30 PM).

---

## The end-to-end pipeline

```
Slack image (user tags bot, attaches image.png)
  │
  ▼
chat-sdk-bridge.ts        att.fetchData() → base64 in the message content
  │
  ▼
session-manager.ts        extractAttachmentFiles(): writes the bytes to
  │                        data/v2-sessions/<group>/<session>/inbox/<msgId>/<name>
  │                        and replaces the inline data with `localPath` in the
  │                        message JSON (messages_in.content). msgId contains a
  │                        COLON, e.g. `1782840926.498869:ag-...` → inbox path has a colon.
  ▼
poll-loop.ts              extractImageAttachments(): reads attachments[] where
  │                        localPath + mimeType (image/*) are present → AttachmentRef[].
  │                        Also: formatter.ts appends a TEXT hint to the prompt:
  │                        "[image: image.png — saved to /workspace/inbox/...]"
  ▼
opencode.ts (provider)    For each image AttachmentRef:
  │                          • read /workspace/<localPath> off disk
  │                          • base64-encode
  │                          • push { type:'file', mime, filename, url:'data:<mime>;base64,<b64>' }
  │                        promptAsync body = { parts:[ {type:'text'}, ...fileParts ], system }
  │                        Model must be declared with image input modality (bug 1).
  ▼
opencode serve            Vercel AI SDK + @openrouter/ai-sdk-provider. A `file` part with a
  │                        data: URL + image mime → OpenRouter `image_url` content block.
  │                        (A file:// URL → resource_link, NOT forwarded as image — bug 3.)
  ▼
OneCLI gateway (proxy)    Injects the OpenRouter credential (HTTPS forward proxy, MITM CA).
  ▼
OpenRouter                Routes to a provider endpoint per OPENCODE_OPENROUTER_ROUTING.
  │                        Records a generation (num_media_prompt counts the image).
  ▼
Provider endpoint         Must actually run the model's vision tower (bug 4 — DeepInfra fp8 did NOT).
  ▼
Mistral Small 3.2 24B     Describes the image → reply wrapped in <message to="slack">…</message>
```

The **two session DBs** are the only host↔container IO. Inbound attachment bytes live on
disk in the session `inbox/`, NOT in the DB (DB carries only `localPath` metadata).

---

## Current configuration (2026-06-30)

`~/.config/nanoclaw/secrets.env` (loaded by the host systemd unit `EnvironmentFile`,
passed into each container as `-e`):

```bash
OPENCODE_PROVIDER=openrouter
OPENCODE_MODEL=openrouter/mistralai/mistral-small-3.2-24b-instruct
OPENCODE_SMALL_MODEL=openrouter/mistralai/mistral-small-3.2-24b-instruct
# Vision works on the Mistral first-party endpoint. DeepInfra fp8 accepted the
# image but did not apply vision (see Provider testing below).
OPENCODE_OPENROUTER_ROUTING={"only":["mistral"],"data_collection":"deny"}
```

> ⚠️ **Changing secrets.env requires a HOST restart** to reload it, then the image is live on
> the next message: `systemctl --user restart nanoclaw-v2-a72e394a.service`.
> Container source (`opencode.ts`) is bind-mounted RO and run with `bun` — code changes need
> only a group container restart (`ncl groups restart --id <id>`), NO image rebuild.

> ⚠️ **Cost/retention caveat:** Mistral first-party is the priciest endpoint ($0.10/$0.30 per 1M)
> and routes to Mistral's own API. The open TODO is to find the cheapest **vision-working**
> provider (see [[Clients/Personal/AgentNotes/Active/2026-06-30 NanoClaw Vision Provider Test Script (TODO)]]).

### The code fix (bug 3)

`container/agent-runner/src/providers/opencode.ts` — the fileParts loop now reads the file
and inlines base64, via an injectable `_readImageBase64` seam (mirrors `_setSleepForTest`):

```typescript
const base64 = _readImageBase64(att.localPath);            // reads /workspace/<localPath>
fileParts.push({
  type: 'file', mime: att.mimeType, filename: att.name,
  url: `data:${att.mimeType};base64,${base64}`,            // NOT file://
});
```

Tests: `container/agent-runner/src/image-attachments.test.ts` (Layer 3) assert data: URLs and
a skip-on-unreadable case. Full suite: 89 pass / 0 fail; `tsc --noEmit` clean.

---

## How images are encoded for OpenRouter

OpenCode / Vercel AI SDK / `@openrouter/ai-sdk-provider` only forward an image when the part is
a **base64 `data:` URL** (or raw base64). Confirmed in OpenCode source:

- `convertFilePart`: `data:` → inlined; `http(s)://` → *"Remote URLs are not supported"* (dropped); raw base64 → wrapped as data URL.
- `filePartToContentChunks`: a `file://` URL becomes a **`resource_link`** (reference only); only `data:` URLs decode to `type:"image"` content.
- Official OpenCode image-input example reads local files and builds `data:${mime};base64,…`.
- Vision gating uses the model's `modalities` field (GitHub issue anomalyco/opencode#9897) — the correct, if undocumented, config key.

---

## DEBUGGING PLAYBOOK (for future agents)

Work the pipeline in order. Stop at the first layer that's wrong.

### 0. Identify the live session
```bash
cd ~/Prosjekter/Personal/Slackbot/nanoclaw_bot/nanoclaw
NEW=$(ls -td data/v2-sessions/ag-*/sess-* | head -1); echo $NEW
```

### 1. Did the image reach disk? (host extraction OK)
```bash
find "$NEW/inbox" -type f          # expect inbox/<msgId>/image.png
```
And confirm `localPath` is in the message JSON (NOT just `data=` or `url=`):
```bash
pnpm exec tsx scripts/q.ts "$NEW/inbound.db" \
  "SELECT content FROM messages_in ORDER BY seq DESC LIMIT 1"   # look for attachments[].localPath
```
Missing `localPath` → bug in `session-manager.ts extractAttachmentFiles` or `poll-loop.ts extractImageAttachments`.

### 2. What did the container actually send? (OpenCode parts)
OpenCode persists every message part in its per-session SQLite DB:
```bash
DB="$NEW/opencode-xdg/opencode/opencode.db"
pnpm exec tsx scripts/q.ts "$DB" "SELECT substr(data,1,120) FROM part ORDER BY time_created"
```
- Expect a user part `{"type":"file","mime":"image/png","url":"data:image/png;base64,iVBOR…"}`.
- If you instead see `file://…` or only a text hint + a later `Read` tool call → bug 3 regressed.
- The OpenCode server log for the run: `$NEW/opencode-xdg/opencode/log/<timestamp>.log`.

### 3. What did OpenRouter receive & which provider served it? (the decisive step)
OpenCode does NOT persist the OpenRouter generation id. Get it from the **OneCLI gateway** logs:
```bash
docker logs onecli --since <ISO time> 2>&1 | grep -aoE 'gen-[A-Za-z0-9]+' | sort -u
```
Then inspect it with the **OpenRouter MCP** (see below). Key fields:
- `num_media_prompt` ≥ 1  → the image reached OpenRouter as media. If 0 → bug 3 (part not inlined).
- `provider_name` / `provider_responses[].provider_name` → which endpoint served it.
- `finish_reason`, `native_tokens_prompt` → if media counted but tokens look text-only and the model
  refuses, the **provider endpoint isn't applying vision** (bug 4) → change routing.

### 4. Is it the model refusing for another reason?
```bash
grep -riE "image|vision|can.?t (read|see|view)" \
  groups/cli-with-mathipe/CLAUDE.md groups/cli-with-mathipe/CLAUDE.local.md \
  groups/cli-with-mathipe/.claude-fragments/ container/CLAUDE.md
```
A stale "you can't read images" instruction in memory would make a vision model refuse. (Checked clean on 2026-06-30.)

---

## OpenRouter MCP server (reference)

The `openrouter` MCP server is the primary tool for diagnosing the provider layer.
Useful tools (call via the `mcp` gateway tool, `tool:` + `args` as JSON; note the `request` wrapper):

| Tool | Use | Example args |
|---|---|---|
| `openrouter_model-endpoints` | List every provider endpoint for a model (quant, price, uptime, throughput, supported_parameters) | `{"request":{"author":"mistralai","slug":"mistral-small-3.2-24b-instruct"}}` |
| `openrouter_model-get` | Model-level details incl. `architecture.input_modalities` | `{"request":{"author":"mistralai","slug":"mistral-small-3.2-24b-instruct"}}` |
| `openrouter_generation-get` | **Inspect a single generation** — provider served, `num_media_prompt`, cost, tokens, finish reason | `{"request":{"id":"gen-..."}}` |
| `openrouter_chat-send` | Quick text chat / provider pin test. **TEXT ONLY — cannot send images** | `{"model":"...","message":"...","provider":{"only":["mistral"],"allow_fallbacks":false}}` |
| `openrouter_docs-search` | Search OpenRouter docs | `{"query":"image inputs"}` |
| `openrouter_credits-get` | Account balance | `{}` |

**Critical gap:** neither `model-endpoints` nor `model-get` exposes a *per-endpoint* "supports image
input" flag. `architecture.input_modalities:[image,text]` is **model-level only**. You CANNOT tell
from the API which provider actually serves working vision — you must test empirically (below).
Worse: OpenRouter will still route an image request to an endpoint that accepts but ignores it
(DeepInfra did exactly this), so routing success ≠ vision works.

---

## Providers for `mistralai/mistral-small-3.2-24b-instruct`

From `openrouter_model-endpoints` (2026-06-30). Model architecture: `text+image->text`.

| Provider | Quant | Prompt $/M | Completion $/M | Vision (empirical) |
|---|---|---|---|---|
| DeepInfra | fp8 | 0.075 | 0.20 | ❌ accepts image, ignores it (`num_media_prompt:1` but refuses) |
| Parasail | bf16 | 0.09 | 0.30 | ❓ untested |
| Venice | fp8 | 0.094 | 0.25 | ❓ untested |
| Mistral (first-party) | full | 0.10 | 0.30 | ✅ works (current pin) |

---

## Testing an individual provider

### Method A — via NanoClaw (end-to-end, slow)
1. Edit `OPENCODE_OPENROUTER_ROUTING` → `{"only":["<provider>"],"allow_fallbacks":false,"data_collection":"deny"}`.
   `allow_fallbacks:false` is essential — it forces THIS provider or a hard failure, no silent reroute.
2. `systemctl --user restart nanoclaw-v2-a72e394a.service`
3. Re-send the image in Slack.
4. Grab the `gen-...` id from `docker logs onecli` and run `openrouter_generation-get` → check `provider_name`,
   `num_media_prompt`, and whether the reply describes the image.

### Method B — direct OpenRouter call through the OneCLI gateway (fast, no nanoclaw)
The gateway is a credential-injecting HTTPS forward proxy. From the host you can hit OpenRouter directly:
```bash
# The proxy token is minted by the host per run; grab it from the running container spawn:
TOK=$(ps aux | grep 'docker run' | grep -v grep | grep -oE 'aoc_[a-f0-9]+' | head -1)
PROXY="http://x:${TOK}@127.0.0.1:10255"
CA=/tmp/onecli-combined-ca.pem      # MITM CA the gateway presents
curl -s --proxy "$PROXY" --cacert "$CA" https://openrouter.ai/api/v1/models | head -c 100
```
A full image test = POST `/api/v1/chat/completions` with a base64 `data:` image_url part and
`provider:{only:[p],allow_fallbacks:false}`. Automating this loop over all providers is the
open TODO (see below) — it gives a definitive pass/fail vision matrix in seconds.

> The `chat-send` MCP tool is text-only, so it canNOT be used for image tests — Method B (raw curl) is required for automated vision checks.

---

## Gotchas / lessons

- **`num_media_prompt:1` does NOT mean the model saw the image** — only that OpenRouter forwarded it.
  The serving endpoint can still drop it (DeepInfra fp8).
- **A vision model refusing "I can't read images" is usually a provider/transport problem**, not the model.
- The inbox path contains a **colon** (`<ts>:<group>`); harmless for `readFileSync`/data URLs, but it broke
  `file://` URL handling — another reason data: URLs are correct.
- Cheapest-by-price routing (`sort:price`) tends to land on quantized endpoints that are likeliest to
  have broken/disabled vision. Prefer full/bf16 endpoints for multimodal.

---

## Related
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/Mistral Vision Images & System Prompt — OpenCode Provider Fixes]] — bugs 1 & 2 (modalities + system field)
- [[Clients/Personal/AgentNotes/Active/2026-06-30 NanoClaw Vision Provider Test Script (TODO)]] — the provider matrix script
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/OpenCode + OpenRouter Configuration]] — model id format, bundled-list bypass
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/Env Var Loading Architecture — secrets.env vs .env]] — how OPENCODE_* reach the container
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/NanoClaw Operations]] — restart/logs runbook
