---
tags: [nanoclaw, openrouter, vision, testing, todo, script]
type: work
status: todo
date: 2026-06-30T00:00:00.000Z
---

# 2026-06-30 NanoClaw Vision Provider Test Script (TODO)

**Goal:** A script that tests *every* OpenRouter provider endpoint for a model and reports a
pass/fail **vision matrix** (does the provider actually read an image), plus price — so we can
pick the cheapest **vision-working** provider instead of paying Mistral first-party rates.

Context: [[Clients/Personal/AgentNotes/Reference/NanoClaw/Slack Image Handling — Pipeline, OpenRouter Vision & Debugging]]

## Why

- Vision currently works only because we pinned `OPENCODE_OPENROUTER_ROUTING={"only":["mistral"]}` (priciest endpoint).
- DeepInfra fp8 (cheapest) accepts the image but ignores it. Parasail (bf16) and Venice (fp8) are **untested**.
- The OpenRouter API/MCP exposes **no per-endpoint vision flag** — the only way to know is to send a real image and check the reply.

## Status / progress

- [x] Confirmed the pipeline + the 4 endpoints (DeepInfra ❌, Mistral ✅, Parasail ❓, Venice ❓).
- [x] Confirmed the OneCLI gateway proxy is reachable from the host with the MITM CA (got `/api/v1/models`).
- [ ] Write the script (below).
- [ ] Run it; record results back into the reference doc's provider table.
- [ ] Re-pin `OPENCODE_OPENROUTER_ROUTING` to the cheapest vision-working provider; restart host; verify in Slack.

## Design

**Approach (Method B — direct OpenRouter via the OneCLI gateway, no nanoclaw round-trip).**

Inputs:
- `MODEL=openrouter/mistralai/mistral-small-3.2-24b-instruct` (strip the `openrouter/` for the API `model` field).
- A small test image with unambiguous content (e.g. a red square + the word "VISION"), base64-encoded as a `data:` URL. A reusable fixture should live at `container/agent-runner/test-fixtures/vision-probe.png` (commit it).
- Provider list: pull dynamically from `openrouter_model-endpoints` (don't hardcode) so new providers are picked up.

Auth (the tricky part):
- The gateway is a credential-injecting HTTPS forward proxy at `127.0.0.1:10255`, basic auth user `x`, password = the `aoc_…` token.
- The token is minted by the host per run — grab it live:
  `TOK=$(ps aux | grep 'docker run' | grep -v grep | grep -oE 'aoc_[a-f0-9]+' | head -1)`
- MITM CA: `--cacert /tmp/onecli-combined-ca.pem`.
- If no container is running (no token), the script should spawn a throwaway `nanoclaw-agent-v2-*` container that already has the gateway env, OR document that one must send any Slack message first to mint a token.

For each provider `p`:
```
POST https://openrouter.ai/api/v1/chat/completions
body = {
  model: "mistralai/mistral-small-3.2-24b-instruct",
  provider: { only: [p], allow_fallbacks: false },   // hard-pin, no silent reroute
  messages: [{ role:"user", content: [
    { type:"text", text:"Reply with ONLY the exact text shown in this image. If you cannot see an image, reply exactly: NO_IMAGE." },
    { type:"image_url", image_url:{ url: "data:image/png;base64,<b64>" } }
  ]}],
  max_tokens: 50
}
```
Classify:
- Response text contains the known word in the image → **PASS (vision works)**.
- `NO_IMAGE` / refusal / wrong text → **FAIL**.
- HTTP 404 / "no allowed providers" → provider can't serve (with `allow_fallbacks:false`).

Then optionally read back `id` (gen-…) → `openrouter_generation-get` to log `num_media_prompt` + `provider_name` for the record.

Output a table: `provider | quant | $prompt | $completion | vision PASS/FAIL | gen-id`.

## Notes / gotchas to bake in
- Use `allow_fallbacks:false` always, or you'll silently test the wrong provider.
- `num_media_prompt:1` ≠ vision works — must check the actual answer text.
- Don't rely on the MCP `chat-send` tool — it's text-only and can't carry the image.
- The `aoc_` token rotates; never hardcode it.
- Keep the probe image tiny (<50 KB) to stay well under OpenCode's 5 MB base64 limit and keep cost ~$0.

## Suggested location
`scripts/test-vision-providers.ts` (run via `pnpm exec tsx`), with the fixture committed under `container/agent-runner/test-fixtures/`.

## Related
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/Slack Image Handling — Pipeline, OpenRouter Vision & Debugging]]
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/NanoClaw Operations]]
