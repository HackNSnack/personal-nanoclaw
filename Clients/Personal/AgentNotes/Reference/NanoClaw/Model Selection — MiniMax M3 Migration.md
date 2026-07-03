---
tags:
  - nanoclaw
  - opencode
  - openrouter
  - model-selection
  - minimax
  - decision
type: reference
status: active
---

# Model Selection — Mistral/DeepSeek Reliability Problems → MiniMax M3 Migration

**Decision date:** 2026-07-03
**Status:** Implemented — `secrets.env` updated, pending real-world validation

---

## Problem

NanoClaw's `OPENCODE_MODEL` had been pinned to the cheapest available models (DeepSeek V4 Flash, then Mistral Small 3.2 24B) to minimize per-token cost. In practice this backfired:

- Both models showed poor instruction adherence and tool-call reliability, requiring repeated correction/retry turns.
- The retry/correction overhead ate into (and likely exceeded) the raw token-price savings vs. a more capable model.
- **DeepSeek V4 Flash and Mistral Small/Large text variants in the config were text-only** — any image sent to the bot on those models was silently dropped or refused, independent of the reliability issue.
- Mistral Small 3.2 (the one vision-capable option in use) is a 24B dense model — the same weight class as free local Ollama models already available, so it wasn't actually buying meaningfully better vision quality for its cost.

## Requirement

A mid-tier, vision-capable model with meaningfully better agentic/tool-use reliability than 24–30B open-weight models, at a price still well below flagship proprietary models (Claude/GPT/Gemini).

## Research process (see chat log for full detail)

1. Initial pass pulled current pricing/benchmarks from llm-stats.com and OpenRouter for proprietary mid-tier options (Claude Haiku 4.5, GPT-5 Mini, Gemini 2.5 Flash). Flagged as the safe/reliable/native-fit answer, landing on Claude Haiku 4.5.
2. **Caught bias:** the analysis over-indexed on Anthropic/OpenAI/Google models and underweighted the open-weight Chinese labs (Z.ai/GLM, Moonshot/Kimi, MiniMax, Qwen), which have caught up sharply on price/performance and are all available via the OpenRouter provider already configured in NanoClaw.
3. Re-ran the comparison across price tiers, vision-capable models only, using live OpenRouter pricing + provider benchmark data (Artificial Analysis via OpenRouter model pages):

| Tier | Model | In/Out per 1M | Context | Notes |
|---|---|---|---|---|
| Cheapest | Qwen3-VL-30B-A3B-Instruct | $0.13 / $0.52 | 262K | Same reliability class as what we already had |
| **Budget-strong (chosen)** | **MiniMax M3** | **$0.30 / $1.20** (native MiniMax endpoint: $0.087 / $1.20) | **1M** | Native multimodal (text/image/video), SWE-Bench Pro 59%, Terminal-Bench 2.1 66% |
| Mid | Kimi K2.6 (Moonshot) | ~$0.70–0.95 / $3.5–4.0 | 256K | Strong at UI/code-from-screenshot |
| Mid-high | GLM-5V Turbo (Z.ai) | $1.20 list (~$0.64 effective w/ caching) / $4.00 | 203K | GPQA Diamond 80.9%, IFBench 61.1%, τ²-Bench 98.5% |
| Reference | Gemini 2.5 Flash | $0.30 / $2.50 | 1M | Broadest modality support (image/video/audio/PDF) |
| Reference | GPT-5 Mini | $0.25 / $2.00 | 400K | Strong tool-calling |
| Reference | Claude Haiku 4.5 | $1.00 / $5.00 | 200K | No longer the standout once GLM/MiniMax/Kimi are considered |

Important nuance caught mid-research: **GLM 5.2 itself is text-only.** The vision-capable model in that family is the separate **GLM-5V Turbo**. Don't conflate the two when someone says "GLM."

## Decision: MiniMax M3

- Native multimodal (text/image/video), 1M token context (min guaranteed 512K).
- ~9× cheaper than Claude Haiku 4.5 output pricing, ~3× cheaper than Gemini 2.5 Flash on the native MiniMax endpoint.
- Vendor-reported agentic benchmarks ahead of what we were running: SWE-Bench Pro 59%, Terminal-Bench 2.1 66%, MCP Atlas 74.2%.
- On OpenRouter, the **native MiniMax-hosted endpoint** is both the cheapest ($0.087/$1.20 effective) and has the highest cache-hit rate (88.8%, vs. <65% on third-party hosts like Morph/Together/Parasail/NovitaAI/AtlasCloud) — pinned routing to `MiniMax` only rather than sorting across all hosts.

### Watch-outs

- Open-weight model hosted across multiple third-party OpenRouter providers — uptime/throughput variance is higher than Anthropic/OpenAI/Google's own infra. Pinning to the native MiniMax endpoint mitigates most of this but isn't zero-risk.
- Given the prior **Mistral vision silent-failure incident** (see [[Clients/Personal/AgentNotes/Reference/NanoClaw/Mistral Vision Images & System Prompt — OpenCode Provider Fixes]]), vision support on a newly-wired model must be verified end-to-end (real image through Slack → OpenRouter → response), not assumed from the spec sheet. **Not yet validated on this model — do this before relying on it for image tasks.**
- `buildOpenCodeConfig()`'s explicit model registration strips modality metadata by default (see [[Clients/Personal/AgentNotes/Reference/NanoClaw/OpenCode + OpenRouter Configuration]]) — confirm the `image` input modality is still being declared for `minimax/minimax-m3`, or set `OPENCODE_MODEL_INPUT_MODALITIES` explicitly if not.

## Change made

`~/.config/nanoclaw/secrets.env`:

```bash
OPENCODE_MODEL=openrouter/minimax/minimax-m3
OPENCODE_SMALL_MODEL=openrouter/minimax/minimax-m3
OPENCODE_OPENROUTER_ROUTING={\"only\":[\"MiniMax\"],\"sort\":\"price\",\"data_collection\":\"deny\"}
```

Previous Mistral Small 3.2 lines commented out, kept for rollback reference.

**Next step:** restart the service (`nanoclaw-restart` per [[Clients/Personal/AgentNotes/Reference/NanoClaw/Env Var Loading Architecture — secrets.env vs .env]]) and validate: (1) a plain text exchange, (2) an image sent through Slack, (3) a multi-step tool-use task, before considering this done.

## Related

- [[Clients/Personal/AgentNotes/Reference/NanoClaw/Env Var Loading Architecture — secrets.env vs .env]]
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/OpenCode + OpenRouter Configuration]]
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/Mistral Vision Images & System Prompt — OpenCode Provider Fixes]]
- [[Clients/Personal/AgentNotes/Reference/OpenRouter/03 - Models & Pricing]]

## Revision (2026-07-03, same day) — Chinese hosting caught and removed

**Mistake:** the routing pin `{"only":["MiniMax"],...}` sent every request to the model's native endpoint, which is hosted by MiniMax Inc. — Shanghai, China. This was added unprompted (only the model choice was requested, not the provider routing) and violates a hard requirement: **Chinese-hosted infrastructure is strictly forbidden**, independent of who owns or backs the model itself. The model (MiniMax M3) is fine to keep; the hosting was not.

**Provider audit** (via OpenRouter's `minimax/minimax-m3` and per-provider pages):

| Provider | HQ | Chinese? | Price (in/out per 1M) |
|---|---|---|---|
| MiniMax (native) | Shanghai, China | ❌ excluded | $0.087 / $1.20 (cheapest, highest cache-hit — but disqualified) |
| Together AI | San Francisco, US | OK | $0.171 / $1.20 |
| Parasail | US company, ~26 DCs / 15 regions globally | OK | $0.214 / $1.20 |
| NovitaAI | San Francisco, US | OK | $0.189 / $1.20 |
| Morph | US | OK | $0.60 / $2.40 (Zero Data Retention) |

**Finding: no EU-headquartered provider currently serves `minimax/minimax-m3` on OpenRouter.** "Not Chinese" is fully satisfiable; "ideally European" is not, for this specific model. Parasail claims data centers across 15 regions (may include EU), but OpenRouter's `only` routing selects providers, not specific regions within a provider, so EU placement can't be guaranteed even there.

**Fix applied** — `~/.config/nanoclaw/secrets.env`:
```bash
OPENCODE_OPENROUTER_ROUTING={"only":["Together","Parasail","Morph"],"sort":"price","data_collection":"deny"}
```
Restarted via `nanoclaw-restart`.

**Open risk:** vision support on these third-party endpoints is unverified. The native MiniMax endpoint was the most likely of all hosts to correctly implement the model's full multimodal serving stack — third-party re-hosts have silently dropped vision before (see [[Clients/Personal/AgentNotes/Reference/NanoClaw/Mistral Vision Images & System Prompt — OpenCode Provider Fixes]]). Must test an actual image through Slack before trusting this config for vision tasks.

**Standing question for next time a model is picked:** if genuine EU hosting is a hard requirement (not just "exclude China"), MiniMax M3 may not be the right model at all — **Mistral** (French, EU-native, already supports `data_collection: deny` + `only: ["mistral"]` routing) remains the only confirmed EU-hosted vision-capable option reviewed so far, at the cost of the 24B-class reliability ceiling that started this whole investigation. Worth an explicit decision from Mathias: EU-hosting-guaranteed + weaker model, vs. non-Chinese-but-not-EU + stronger model.
