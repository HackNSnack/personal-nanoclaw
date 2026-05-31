# OpenRouter — Routing Mechanism

OpenRouter has two independent layers of routing. Understanding both is essential for controlling quality and price.

---

## Layer 1: Provider Routing

For a single model (e.g. `deepseek/deepseek-v4-flash`), many different companies host the same weights. Provider routing determines **which host** serves your request.

All controls live in the `provider` object passed in each request. In pi, this maps directly to the `openRouterRouting` compat field in `models.json`.

### Default: Price-Based Load Balancing

With no configuration, OpenRouter:
1. Filters out providers with outages in the last 30 seconds
2. Selects from stable providers weighted by **inverse square of price** (so a $1 provider is 9× more likely than a $3 one)
3. Uses remaining providers as ordered fallbacks

This is a probabilistic spread — not always the cheapest, but close, with uptime protection.

### Provider Sorting (disables load balancing)

Use `sort` to explicitly prioritise a dimension. Load balancing is disabled when set.

| Value | Behaviour |
|---|---|
| `"price"` | Always cheapest available provider |
| `"throughput"` | Always highest tokens/sec |
| `"latency"` | Always lowest time-to-first-token |

**Shortcut suffixes** (on model name, no extra config needed):
- `model-id:floor` → equivalent to `sort: "price"`
- `model-id:nitro` → equivalent to `sort: "throughput"`

```json
// In openRouterRouting:
{ "sort": "price" }

// Or as model name suffix:
"id": "deepseek/deepseek-v4-flash:floor"
```

### Whitelisting Providers (`only`)

Restrict routing to a specific set of providers. Requests will only go to these — request fails if none are available.

```json
{ "only": ["deepinfra", "parasail", "fireworks", "together"] }
```

### Blacklisting Providers (`ignore`)

Exclude specific providers. Useful for blocking CN-hosted providers.

```json
{ "ignore": ["deepseek", "siliconflow", "baidu-qianfan"] }
```

> **Prefer `only` (whitelist) over `ignore` (blacklist).** A whitelist is explicit and stable — new unwanted providers added to OpenRouter don't slip through automatically.

### Ordered Preference (`order`)

Try providers in a specific order, falling back through the list on failure.

```json
{ "order": ["fireworks", "deepinfra", "together"] }
```

Combine with `allow_fallbacks: false` to hard-fail if none in the list work.

### Disabling Fallbacks

```json
{ "allow_fallbacks": false }
```

Useful when you must guarantee a specific provider (e.g. for compliance or reproducibility).

### Hard Price Cap (`max_price`)

Unlike performance thresholds (which are soft preferences), `max_price` is a **hard filter** — requests fail rather than exceed the cap.

```json
{
  "max_price": {
    "prompt": 0.15,      // Max $/1M input tokens
    "completion": 0.30   // Max $/1M output tokens
  }
}
```

Often combined with `sort: "throughput"` — "fastest provider that doesn't cost more than X".

### Data Collection Filter

```json
{ "data_collection": "deny" }
```

Only routes to providers that don't log or train on prompts. Set this on every model in your config as a default. Can also be set account-wide in OpenRouter privacy settings.

### Quantization Filter

Filter by model precision. Lower precision = cheaper/faster but slightly lower quality.

| Value | Meaning |
|---|---|
| `"fp16"` / `"bf16"` | Full precision (best quality) |
| `"fp8"` | Common production default |
| `"fp4"` | Aggressive compression |
| `"int8"` / `"int4"` | Integer quantization |

```json
{ "quantizations": ["fp8", "fp16", "bf16"] }
```

### Performance Thresholds (soft preferences)

Deprioritise (but don't exclude) providers below a performance threshold. Based on rolling 5-minute percentile stats.

```json
{
  "preferred_min_throughput": { "p50": 50, "p90": 30 },
  "preferred_max_latency":    { "p50": 1,  "p90": 3, "p99": 5 }
}
```

Unlike `max_price`, these never block a request — slow providers become last-resort fallbacks.

### Zero Data Retention (`zdr`)

```json
{ "zdr": true }
```

Only routes to providers with a Zero Data Retention policy. Stricter than `data_collection: "deny"`. Can also be enforced account-wide.

---

## Layer 2: Model Routing

Instead of picking a provider for one model, this selects between different models.

### Model Fallbacks

Pass an array of model IDs. If the first model's providers all fail, the next is tried automatically.

```json
// In OpenRouter SDK / extra_body:
{
  "model": "deepseek/deepseek-v4-flash",
  "models": ["google/gemini-3-flash", "meta-llama/llama-3.3-70b-instruct"]
}
```

The response `model` field tells you which model actually served the request. Billed at that model's rate.

### Auto Router (`openrouter/auto`)

OpenRouter analyses your prompt and picks the best model from a curated pool (powered by NotDiamond). No model selection needed.

```json
{
  "model": "openrouter/auto",
  "plugins": [{
    "id": "auto-router",
    "cost_quality_tradeoff": 5,        // 0 = pure quality, 10 = pure cheap (default: 7)
    "allowed_models": ["deepseek/*", "google/*"]
  }]
}
```

Response always reports which model was selected in the `model` field.

### Latest Alias (`~author/family-latest`)

Always resolves to the newest model in a family. No redeploy needed when a new version ships.

```json
{ "model": "~anthropic/claude-sonnet-latest" }
// response.model → "anthropic/claude-sonnet-4.6"
```

### Model Variants

Suffixes that change routing behaviour:

| Suffix | Effect |
|---|---|
| `:floor` | Sort by price |
| `:nitro` | Sort by throughput |
| `:free` | Use free tier only (rate-limited) |
| `:extended` | Extended context window |
| `:thinking` | Enable reasoning by default |
| `:exacto` | Quality-first signals for tool-calling |

---

## Combining Controls

A realistic production config combining several controls:

```json
{
  "openRouterRouting": {
    "only": ["deepinfra", "parasail", "fireworks", "together", "digital-ocean"],
    "data_collection": "deny",
    "quantizations": ["fp8", "fp16", "bf16"],
    "sort": "price",
    "max_price": { "prompt": 0.20, "completion": 0.40 }
  }
}
```

This reads as: _"Use only these US-based providers. Never log my data. Prefer higher precision. Pick the cheapest. Hard-fail if none are under $0.20/$0.40 per million tokens."_
