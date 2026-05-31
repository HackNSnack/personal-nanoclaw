# OpenRouter — Pi Integration

Pi has native OpenRouter support. Models are added via `~/.pi/agent/models.json` and routing is controlled through the `openRouterRouting` compat field per model. No extra dependencies or SDK setup needed.

---

## File: `~/.pi/agent/models.json`

This file **adds** custom models and providers on top of pi's built-in ones (Anthropic, OpenAI, Google etc. are not removed). It reloads automatically when you open `/model` — no restart required.

### The `openRouterRouting` Compat Field

This is the key integration point. Whatever you set in `openRouterRouting` is passed **as-is** as the `provider` object in OpenRouter API requests. It maps exactly to the routing controls described in [[Clients/Personal/AgentNotes/Reference/OpenRouter/01 - Routing Mechanism]].

```json
"compat": {
  "thinkingFormat": "openrouter",   // Required for reasoning models
  "openRouterRouting": {
    // Any provider routing option from OpenRouter docs goes here
    "only": [...],
    "sort": "price",
    "data_collection": "deny",
    "max_price": { "prompt": 0.20, "completion": 0.40 },
    "quantizations": ["fp8", "fp16", "bf16"]
  }
}
```

### `thinkingFormat`

Controls how pi sends reasoning/thinking parameters to the provider:
- `"openrouter"` — use for OpenRouter-hosted reasoning models (DeepSeek, etc.)
- `"deepseek"` — for direct DeepSeek API (not needed here)
- Omit for non-reasoning models

---

## Full `models.json` Config

```json
{
  "providers": {
    "openrouter": {
      "apiKey": "$OPENROUTER_API_KEY",
      "models": [
        {
          "id": "deepseek/deepseek-v4-flash",
          "name": "DeepSeek V4 Flash (OpenRouter)",
          "reasoning": true,
          "input": ["text"],
          "contextWindow": 1000000,
          "maxTokens": 131072,
          "cost": { "input": 0.10, "output": 0.20, "cacheRead": 0.02, "cacheWrite": 0 },
          "compat": {
            "thinkingFormat": "openrouter",
            "openRouterRouting": {
              "only": ["deepinfra", "parasail", "digital-ocean", "akashml", "fireworks", "together"],
              "data_collection": "deny",
              "quantizations": ["fp4", "fp8", "fp16", "bf16"],
              "sort": "price"
            }
          }
        },
        {
          "id": "deepseek/deepseek-v4-flash",
          "name": "DeepSeek V4 Flash — Fast (OpenRouter)",
          "reasoning": true,
          "input": ["text"],
          "contextWindow": 1000000,
          "maxTokens": 131072,
          "cost": { "input": 0.14, "output": 0.28, "cacheRead": 0.02, "cacheWrite": 0 },
          "compat": {
            "thinkingFormat": "openrouter",
            "openRouterRouting": {
              "only": ["deepinfra", "parasail", "digital-ocean", "akashml", "fireworks", "together"],
              "data_collection": "deny",
              "sort": "throughput"
            }
          }
        },
        {
          "id": "deepseek/deepseek-v4-pro",
          "name": "DeepSeek V4 Pro (OpenRouter)",
          "reasoning": true,
          "input": ["text"],
          "contextWindow": 1000000,
          "maxTokens": 131072,
          "cost": { "input": 0.14, "output": 0.28, "cacheRead": 0.03, "cacheWrite": 0 },
          "compat": {
            "thinkingFormat": "openrouter",
            "openRouterRouting": {
              "only": ["deepinfra", "parasail", "digital-ocean", "akashml", "fireworks", "together"],
              "data_collection": "deny",
              "quantizations": ["fp8", "fp16", "bf16"],
              "sort": "price"
            }
          }
        },
        {
          "id": "google/gemini-3-flash",
          "name": "Gemini 3 Flash (OpenRouter)",
          "reasoning": false,
          "input": ["text", "image"],
          "contextWindow": 1000000,
          "maxTokens": 8192,
          "cost": { "input": 0.50, "output": 3.00, "cacheRead": 0, "cacheWrite": 0 },
          "compat": {
            "openRouterRouting": {
              "only": ["google", "google-vertex"],
              "data_collection": "deny"
            }
          }
        }
      ]
    },
    "mistral-eu": {
      "baseUrl": "https://api.mistral.ai/v1",
      "api": "openai-completions",
      "apiKey": "$MISTRAL_API_KEY",
      "models": [
        {
          "id": "mistral-small-latest",
          "name": "Mistral Small (EU)",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 32000,
          "maxTokens": 8192,
          "cost": { "input": 0.20, "output": 0.60, "cacheRead": 0, "cacheWrite": 0 }
        },
        {
          "id": "mistral-large-latest",
          "name": "Mistral Large (EU)",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 8192,
          "cost": { "input": 0.50, "output": 1.50, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

> **Note on Mistral:** A Mistral API key is optional when using Mistral through OpenRouter (BYOK is opt-in, not required). The `mistral-eu` provider above goes **directly** to `api.mistral.ai`, bypassing OpenRouter entirely — this is the EU-native path. If EU data residency isn't a concern, Mistral models can simply be added to the `openrouter` provider block instead, with no separate API key needed.

---

## Provider Configuration Fields

| Field | Description |
|---|---|
| `apiKey` | API key; supports `$ENV_VAR`, `!shell-command`, or literal string |
| `baseUrl` | API endpoint (omit for built-in OpenRouter provider) |
| `api` | API type: `openai-completions`, `anthropic-messages`, `google-generative-ai` |
| `models` | Array of model configs |
| `modelOverrides` | Override specific built-in model settings without replacing the full list |

## Model Configuration Fields

| Field | Required | Default | Description |
|---|---|---|---|
| `id` | Yes | — | Model ID sent to the API |
| `name` | No | `id` | Display name in `/model` picker |
| `reasoning` | No | `false` | Whether model supports extended thinking |
| `input` | No | `["text"]` | Input types: `["text"]` or `["text", "image"]` |
| `contextWindow` | No | 128000 | Context window in tokens |
| `maxTokens` | No | 16384 | Max output tokens |
| `cost` | No | all zeros | Per-million token costs for pi's cost tracking display |
| `compat` | No | — | Provider compatibility overrides incl. `openRouterRouting` |

---

## Overriding Built-in Models via `modelOverrides`

To customise routing on a built-in OpenRouter model (e.g. a Claude model accessed via OpenRouter) without redefining it:

```json
{
  "providers": {
    "openrouter": {
      "modelOverrides": {
        "anthropic/claude-sonnet-4.5": {
          "name": "Claude Sonnet 4.5 (Bedrock only)",
          "compat": {
            "openRouterRouting": {
              "only": ["amazon-bedrock"],
              "data_collection": "deny"
            }
          }
        }
      }
    }
  }
}
```

---

## API Key Setup

Pi resolves `$ENV_VAR` automatically. Add to `~/.zshrc` or `~/.bashrc`:

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
export MISTRAL_API_KEY="..."          # Only needed for direct Mistral provider
```

## Finding Provider Slugs

1. Go to `openrouter.ai/<author>/<model-id>/providers`
2. Click the **copy icon** next to a provider name → exact slug copied
3. Use in `only`, `ignore`, or `order` arrays

See [[Clients/Personal/AgentNotes/Reference/OpenRouter/02 - Providers]] for the recommended whitelist.

---

## `enabledModels` and OpenRouter Free Variants

OpenRouter exposes free-tier variants of some models with a `:free` suffix in their ID (e.g. `deepseek/deepseek-v4-flash:free`). These are **built-in** models — they exist even without a `models.json` entry and appear in `--list-models`.

### The Problem

`enabledModels` patterns match against both model **names** and model **IDs**. A short glob like `"deepseek-v4-flash"` can match:
- Your custom paid model (via its `name`: `"DeepSeek V4 Flash (OpenRouter)"`)
- The built-in free variant (via its `id`: `deepseek/deepseek-v4-flash:free`)

This causes `:free` to appear in Ctrl+P cycling alongside your paid variant. Worse, if the free variant gets picked (and you lack credits/no billing on OpenRouter), it returns `429 Rate Limited`.

### The Fix

Use the **exact, full model ID** in `enabledModels` instead of a loose glob:

```json
// ❌ Bad — matches both paid and free:
"enabledModels": [
  "deepseek-v4-flash"
]

// ✅ Good — exact match, only picks up your custom entry:
"enabledModels": [
  "deepseek/deepseek-v4-flash"
]
```

The exact ID `deepseek/deepseek-v4-flash` matches your `models.json` entry but does **not** match `deepseek/deepseek-v4-flash:free` (different string). Note: `--list-models` still shows both — that command lists all models, not just enabled ones. The `enabledModels` filter only affects Ctrl+P cycling and `/model` in-session.

### Which Models Have Free Variants?

Check `https://openrouter.ai/models?q=free` or look for `:free` entries in `pi --list-models`. Common ones include DeepSeek V4 Flash, Gemini Flash, and others OpenRouter subsidizes.
