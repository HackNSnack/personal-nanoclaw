# OpenRouter — Providers

This note covers which providers are available, their geography, data retention policies, and which to use (or avoid) for a US/EU-only, privacy-respecting setup.

> **Prefer whitelisting (`only`) over blacklisting (`ignore`).** A whitelist is explicit — new unwanted providers can't silently slip through when OpenRouter adds them.

---

## Recommended Providers (US-based, Zero Retention)

These are the providers to include in `only` arrays for DeepSeek and other open-weight models.

| Slug | Region | Data Retention | Notes |
|---|---|---|---|
| `deepinfra` | 🇺🇸 US | Zero | fp4 available; good uptime; lowest latency |
| `parasail` | 🇺🇸 US | Zero | fp8; solid uptime |
| `fireworks` | 🇺🇸 US | Zero | Broad model support; fast inference |
| `together` | 🇺🇸 US | Zero | Wide model selection; batch API (50% discount) |
| `digital-ocean` | 🇺🇸 US | Zero | Good uptime |
| `akashml` | 🇺🇸 US | Zero | Decentralised US nodes |
| `morph` | 🇺🇸 US | Zero | ⚠️ Poor uptime (~53%) — last-resort fallback only |
| `cerebras` | 🇺🇸 US | Zero | Extremely fast (800+ tok/s); good free tier |
| `groq` | 🇺🇸 US | Zero | Very fast; good free tier |

## EU-Based Options

| Slug / Provider | Region | Data Retention | Notes |
|---|---|---|---|
| `nebius` | 🇳🇱 EU (Netherlands) | Zero | May carry open-weight models incl. DeepSeek |
| Mistral (direct) | 🇫🇷 EU (France) | 30 days | Mistral models only; use `api.mistral.ai` directly |

> **Note:** True EU hosting for DeepSeek models is limited. Most providers hosting DeepSeek are US-based. If EU residency is a hard requirement, Mistral's own API is the cleanest option for EU-hosted inference. Otherwise, US-based providers with zero retention are the next best thing.

## Providers to Exclude

These are Chinese-hosted or have problematic data policies:

| Slug | Region | Issue |
|---|---|---|
| `deepseek` | 🇨🇳 CN | May train on prompts; data stored in China |
| `siliconflow` | 🇨🇳 CN | China-hosted |
| `baidu-qianfan` | 🇨🇳 CN | China-hosted; unknown retention |
| `alibaba` | 🇸🇬 SG | Alibaba Cloud International; unknown retention |
| `gmicloud` | 🇺🇸 US | Unknown retention (not zero) — skip |

## Full Data Retention Reference

Key providers from OpenRouter's official policy table (as of 2026):

| Provider | Retention | Trains on Prompts |
|---|---|---|
| AkashML | Zero | No |
| Amazon Bedrock | Zero | No |
| AtlasCloud | Zero | No |
| Azure | Zero | No |
| Cerebras | Zero | No |
| DeepInfra | Zero | No |
| DeepSeek | Unknown period | **Yes** |
| DigitalOcean | Zero | No |
| Fireworks | Zero | No |
| GMICloud | Unknown period | No |
| Google Vertex | Zero | No |
| Groq | Zero | No |
| Mistral | 30 days | No |
| Morph | Zero | No |
| Nebius | Zero | No |
| NovitaAI | Zero | No |
| Parasail | Zero | No |
| SiliconFlow | Zero | No |
| Together | Zero | No |

## How to Find Exact Provider Slugs

1. Go to `openrouter.ai/<author>/<model>/providers` (e.g. `openrouter.ai/deepseek/deepseek-v4-flash/providers`)
2. Click the **copy icon** next to any provider name to get the exact slug
3. Use that slug in `only`, `ignore`, or `order` arrays

Slugs can include variant suffixes (e.g. `deepinfra/turbo`, `google-vertex/us-east5`). A base slug (e.g. `google-vertex`) matches all variants/regions of that provider.

## Account-Wide Settings

You can set provider preferences globally in OpenRouter account settings (not just per-request):
- **Privacy settings:** Disable providers that train on data account-wide
- **Ignored providers:** Permanently exclude specific providers for all requests
- **Allowed providers:** Whitelist providers account-wide

Per-request settings in `openRouterRouting` are merged with account-wide settings.
