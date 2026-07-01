---
tags: [nanoclaw, opencode, openrouter, mistral, vision, debugging, poll-loop]
type: reference
status: active
---

# Mistral Vision Images & System Prompt — OpenCode Provider Fixes

> [!update] 2026-06-30 PM — the two fixes below were necessary but NOT sufficient.
> Two more layers were found and fixed afterwards: (3) the image part was attached as a
> `file://` URL, which OpenCode treats as a *resource_link* and never inlines → switched to a
> **base64 `data:` URL**; and (4) DeepInfra fp8 *accepted* the image but didn't apply vision →
> **pinned the Mistral first-party endpoint**. The claim below that "the pipeline itself was fine
> end-to-end" is therefore WRONG for the final build. Full current picture & debugging playbook:
> [[Clients/Personal/AgentNotes/Reference/NanoClaw/Slack Image Handling — Pipeline, OpenRouter Vision & Debugging]].

**Symptom:** After switching `OPENCODE_MODEL` from DeepSeek to a vision-capable Mistral model (`openrouter/mistralai/mistral-small-3.2-24b-instruct`), two things broke at once:

1. Asking the bot to read an image → it calls the `Read` tool on the inbox path, gets raw bytes back, and replies *"I'm sorry, but I can't read or interpret images."*
2. The reply also contained the **system prompt echoed back verbatim** (`Wrap each delivered message in a <message to="name">…</message> block…`), and was never delivered — the host's "response was not wrapped" nudge fired.

**First documented:** 2026-06-30  
**Affects:** NanoClaw installs on the `opencode` provider using a **non-Anthropic, vision-capable model** via OpenRouter (Mistral, Pixtral, Gemini, etc.). DeepSeek never exposed either bug because it is text-only and was trained to obey `<system>` XML.

---

## TL;DR — the two fixes

Both in `container/agent-runner/src/providers/opencode.ts`.

| Bug | Root cause | Fix |
|---|---|---|
| Images never reach the model | Explicit `provider.<id>.models` registration (added to dodge `ProviderModelNotFoundError`) **drops the modality metadata** models.dev would have supplied → OpenCode treats the model as text-only and strips image `file` parts before the API call | Declare `modalities: { input: ['text','image'], output: ['text'] }` on the model entry. Override via `OPENCODE_MODEL_INPUT_MODALITIES` |
| System prompt echoed, reply not wrapped | Instructions were folded into the **user turn** as `<system>…</system>` XML. DeepSeek obeyed it; Mistral treats it as ordinary text and parrots it back | Send instructions via the dedicated `system` field on the `promptAsync` body — a real system message. No XML in the user turn |

Source is bind-mounted RO at `/app/src` and run directly with `bun` → **no image rebuild, no host build.** Restart the session container to apply:
```bash
ncl groups restart --id ag-1781098614662-lx2src --message "image test"
```

---

## Background — how images are supposed to flow

```
Slack image
  → chat-sdk-bridge.ts   (att.fetchData() → base64 in content.data)
  → session-manager.ts   (extractAttachmentFiles: writes inbox/<msgId>/<name>, swaps data→localPath)
  → poll-loop.ts         (extractImageAttachments: reads mimeType+localPath → AttachmentRef[])
  → opencode.ts          (builds file parts → promptAsync body.parts)
  → opencode serve       (reads file://, forwards to the model)
  → OpenRouter → model
```

**[CORRECTED 2026-06-30 PM]** The pipeline was NOT fine end-to-end — `chat-sdk-bridge → session-manager → poll-loop` were fine, but the **opencode.ts file-part step itself was broken twice over**: it attached the image as a `file://` URL (treated as a resource_link, never inlined) AND, once that was fixed, the routed DeepInfra endpoint dropped the image. With only the modalities fix, OpenCode/the provider stripped or under-delivered the `file` parts, so the model fell back to a Read tool call. The text prompt still carried the hint `[image: image.png — saved to /workspace/inbox/…]`, so Mistral did the only thing left — called `Read` on that path, got binary, and gave up.

---

## Root cause 1 — modality stripping

OpenCode ships a frozen model registry (models.dev) baked into its binary. New models throw `ProviderModelNotFoundError` *before any API call*. The workaround (documented in [[Clients/Personal/AgentNotes/Reference/NanoClaw/OpenCode + OpenRouter Configuration]]) is to declare the model under `provider.<id>.models.<slug>` so OpenCode trusts the ID without the bundled-list check.

**The catch:** a hand-declared model entry carries *no* modality metadata. With no `modalities`, OpenCode falls back to text-only and strips `file`/image parts before the upstream call. So the very workaround that lets a new model load is also what blinds it to images.

### Fix

```typescript
// buildOpenCodeConfig()
const inputModalities = (process.env.OPENCODE_MODEL_INPUT_MODALITIES || 'text,image')
  .split(',').map((s) => s.trim()).filter(Boolean);

const modelEntry = {
  ...(routingOpts ? { options: { provider: routingOpts } } : {}),
  modalities: { input: inputModalities, output: ['text'] },
};
// modelEntry is assigned to every declared slug (main + small)
```

Resulting config (`provider.openrouter.models`):
```json
{
  "mistralai/mistral-small-3.2-24b-instruct": {
    "options": { "provider": { /* OPENCODE_OPENROUTER_ROUTING */ } },
    "modalities": { "input": ["text", "image"], "output": ["text"] }
  }
}
```

- Default `text,image` restores vision forwarding.
- Set `OPENCODE_MODEL_INPUT_MODALITIES=text` for a genuinely text-only model (avoids forwarding parts the API would reject).

---

## Root cause 2 — `<system>` XML echoed into the reply

The runtime addendum (agent name + live destinations + the message-wrapping rules) used to be prepended to the **user message**:

```typescript
// OLD — wrapPromptWithContext()
out = `<system>\n${systemInstructions}\n</system>\n\n${userText}`;
```

DeepSeek was trained to treat that as out-of-band instructions. Mistral treats it as ordinary user text — so it both *echoed the rules back* (the `Wrap each delivered message…` leak in the logs) and *failed to follow them* (reply not wrapped in `<message to="…">`, triggering the host's undelivered-nudge).

### Fix

The OpenCode SDK's `promptAsync` body has a dedicated `system?: string` field (forwarded to the provider as a real system message). Instructions now ride that:

```typescript
await client.session.promptAsync({
  path: { id: sessionId },
  body: {
    parts: [{ type: 'text', text }, ...fileParts],
    ...(systemInstructions ? { system: systemInstructions } : {}),
  },
});
```

`wrapPromptWithContext()` is gone; the user turn now carries only the raw prompt. This is provider-agnostic — strictly better for DeepSeek too. (Note: this is the *runtime* addendum; the static project docs `/app/CLAUDE.md`, per-group fragments, and `CLAUDE.local.md` still load via OpenCode's native `instructions` file list.)

---

## Why this was "parsing logic tailored to DeepSeek"

The operator's instinct was right. The whole delivery contract had quietly specialized to DeepSeek's quirks:
- `<system>` XML in the user turn (DeepSeek obeyed it).
- The unclosed-`</message>` fallback + 400ms SSE drain window (see [[Clients/Personal/AgentNotes/Reference/NanoClaw/DeepSeek Missing Closing Tag — Silent Response Drop]]).
- `MEMORY.md` rules like "all tool calls before text" (DeepSeek fires `session.idle` right after text).

None of those assumptions hold for Mistral. The two fixes here remove the two that actively broke; the others are harmless when idle but worth revisiting if Mistral stays.

---

## Tests added

New file `container/agent-runner/src/providers/opencode.system-modalities.test.ts` (9 tests). `buildOpenCodeConfig` was exported (pure env+options fn) to make it unit-testable.

- **Modalities (6):** default `text,image`; `OPENCODE_MODEL_INPUT_MODALITIES=text` override; comma+whitespace parsing; applied to both main & small slug; routing options preserved alongside modalities; empty-entry filtering.
- **System field (3):** `body.system` populated from `systemContext.instructions`; omitted when absent; user text part stays raw (no `<system>`, no instruction leakage).

Full suite green: **97 pass / 0 fail** (88 existing provider+image + 9 new), run in-container with real `bun`; `tsc --noEmit` clean.

```bash
# run a suite against the working tree without rebuilding the image
docker run --rm -v "$(pwd)/container/agent-runner:/app/agent-runner:ro" \
  --entrypoint /bin/bash nanoclaw-agent:latest -c \
  'cd /tmp && cp -r /app/agent-runner/* . && bun test src/providers/ src/image-attachments.test.ts'
```

---

## ⚠️ Caveat — OpenRouter provider routing pin

> [!done] RESOLVED 2026-06-30 PM. This caveat was the real final blocker. The DeepSeek-era pin
> routed to DeepInfra fp8, which accepts images but doesn't apply vision. Now pinned to
> `{"only":["mistral"],"data_collection":"deny"}` (first-party, vision-working). Finding the
> cheapest vision-working provider is tracked in
> [[Clients/Personal/AgentNotes/Active/2026-06-30 NanoClaw Vision Provider Test Script (TODO)]].

`OPENCODE_OPENROUTER_ROUTING` in `~/.config/nanoclaw/secrets.env` still carries the DeepSeek-era pin:
```json
{"only":["deepinfra","parasail","digital-ocean","akashml","fireworks","together"],"data_collection":"deny","sort":"price"}
```
Even with modalities fixed, if OpenRouter routes the Mistral model to an endpoint in `only` that doesn't serve **vision** for it, images can still fail at the provider. Verify against `https://openrouter.ai/mistralai/mistral-small-3.2-24b-instruct/providers` and drop non-vision endpoints from `only` (or remove the pin to test).

---

## ⚠️ Follow-up — `MEMORY.md` / `CLAUDE.local.md` is stale

The agent's memory (mirrored at [[Clients/Personal/AgentNotes/Reference/NanoClaw/MEMORY.md]]) still says *"OpenCode provider + DeepSeek V4 Flash"* and is full of DeepSeek-specific rules ("all tool calls before text", `session.idle` timing). Source of truth is `/workspace/agent/CLAUDE.local.md`; update it there and re-mirror per the sync protocol (paired Obsidian PR) — do **not** hand-edit the mirror.

---

## Relevant source files

| File | Role |
|---|---|
| `container/agent-runner/src/providers/opencode.ts` | `buildOpenCodeConfig()` modalities; `promptAsync` `body.system`; removed `wrapPromptWithContext()` |
| `container/agent-runner/src/providers/opencode.system-modalities.test.ts` | New regression tests |
| `container/agent-runner/src/poll-loop.ts` | `extractImageAttachments()`, dispatch/wrapping-nudge flow |
| `~/.config/nanoclaw/secrets.env` | `OPENCODE_MODEL`, `OPENCODE_PROVIDER`, `OPENCODE_OPENROUTER_ROUTING`, new optional `OPENCODE_MODEL_INPUT_MODALITIES` |

---

## Related

- [[Clients/Personal/AgentNotes/Reference/NanoClaw/OpenCode + OpenRouter Configuration]] — model ID format, bundled-list bypass (where modalities are now declared)
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/DeepSeek Missing Closing Tag — Silent Response Drop]] — the other DeepSeek-specific delivery quirk
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/OpenCode ProviderModelNotFoundError — Stale Session Loop]] — the error the explicit `models:` registration avoids
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/Env Var Loading Architecture — secrets.env vs .env]] — how `OPENCODE_*` reach the container
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/NanoClaw Operations]] — restart/logs runbook
