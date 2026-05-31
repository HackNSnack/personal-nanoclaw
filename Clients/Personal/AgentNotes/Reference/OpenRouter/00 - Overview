# OpenRouter — Overview

> OpenRouter is a unified API gateway that provides access to hundreds of LLM models through a single OpenAI-compatible endpoint. It handles provider routing, fallbacks, and billing aggregation — so you pay one place and get access to everything.

## Why Use It

Your Anthropic subscription (Claude Opus/Sonnet) costs **$3–$25 per million tokens**. OpenRouter gives access to models of comparable quality for **$0.10–$0.30 per million tokens** — a 10–100× reduction depending on the model and task.

Key benefits:
- Single API key, single billing account
- Automatic fallbacks if a provider goes down
- Full control over which providers are used (whitelist/blacklist, price caps, etc.)
- OpenAI-compatible — drop-in replacement in pi and any other tooling
- No markup on inference — you pay provider rates directly

## Key Concepts

OpenRouter has two distinct layers of routing that are often conflated:

### Layer 1: Provider Routing
For a given model (e.g. `deepseek/deepseek-v4-flash`), multiple third-party companies host the same weights. OpenRouter picks **which host** to send your request to. You control this with the `provider` object in requests.

→ See [[Clients/Personal/AgentNotes/Reference/OpenRouter/01 - Routing Mechanism]]

### Layer 2: Model Routing
Instead of picking a provider for one model, this is about picking **which model to use** — including fallbacks between models, AI-powered model selection, and model aliases.

→ See [[Clients/Personal/AgentNotes/Reference/OpenRouter/01 - Routing Mechanism]]

## Pricing & Fees

- **Inference:** No markup — you pay exactly what the underlying provider charges
- **Credit top-up fee:** 5.5% (minimum $0.80) charged when purchasing credits
- **BYOK (Bring Your Own Key):** First 1M requests/month free, then 5% fee. Optional — not required
- **Tracking:** Full usage history at `openrouter.ai/activity`

## Data & Privacy

- Prompts are **not logged by default** by OpenRouter itself
- Opt-in logging available for a 1% discount
- Each provider has its own data retention policy — controllable via `data_collection: "deny"` in routing config
- Enterprise EU in-region routing available (enterprise plan only)

→ See [[Clients/Personal/AgentNotes/Reference/OpenRouter/02 - Providers]] for per-provider data policies

## Pi Integration

OpenRouter is a built-in provider in pi. Models are added via `~/.pi/agent/models.json` and routing is controlled through the `openRouterRouting` compat field per model.

→ See [[Clients/Personal/AgentNotes/Reference/OpenRouter/04 - Pi Integration]]

## Useful Links

- [OpenRouter Models](https://openrouter.ai/models)
- [OpenRouter Docs — Provider Routing](https://openrouter.ai/docs/provider-routing)
- [OpenRouter Docs — Model Fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks)
- [OpenRouter Activity](https://openrouter.ai/activity)
- [LLM Cloud Hub — Pricing Tracker](https://llmcloudhub.com/llm-pricing)
- [Price Per Token](https://pricepertoken.com/)
