# OpenRouter — Models & Pricing

Current model recommendations for cheap, high-quality inference as of 2026. All prices are per million tokens (input / output).

> Prices change frequently. Always verify at [openrouter.ai/models](https://openrouter.ai/models) or [pricepertoken.com](https://pricepertoken.com) before making budget decisions.

---

## Recommended Models

### DeepSeek V4 Flash — Primary Workhorse

- **Model ID:** `deepseek/deepseek-v4-flash`
- **Price (via US providers):** ~$0.10 / $0.20 per 1M tokens (input/output)
- **Context window:** 1M tokens
- **Reasoning:** Yes (efforts: `high`, `xhigh`)
- **Architecture:** MoE — 284B total params, 13B activated
- **Best for:** General coding, chat, agents, most everyday tasks
- **Comparable to:** GPT-5.4 class quality at ~24× lower cost
- **Providers page:** [openrouter.ai/deepseek/deepseek-v4-flash/providers](https://openrouter.ai/deepseek/deepseek-v4-flash/providers)

### DeepSeek V4 Pro — Heavy Reasoning

- **Model ID:** `deepseek/deepseek-v4-pro`
- **Price (via US providers):** ~$0.14 / $0.28 per 1M tokens
- **Context window:** 1M tokens
- **Reasoning:** Yes
- **Architecture:** MoE — 1.6T total params, 49B activated
- **Best for:** Complex multi-step reasoning, full codebase analysis, agentic workflows
- **Providers page:** [openrouter.ai/deepseek/deepseek-v4-pro/providers](https://openrouter.ai/deepseek/deepseek-v4-pro/providers)

### Google Gemini 3 Flash — Long Context

- **Model ID:** `google/gemini-3-flash`
- **Price:** $0.50 / $3.00 per 1M tokens
- **Context window:** 1M tokens
- **Reasoning:** No
- **Best for:** Document-heavy tasks, long context analysis, image input
- **Providers:** `google`, `google-vertex` (both zero retention)

### Mistral Small (EU-native)

- **Model ID (via Mistral direct):** `mistral-small-latest`
- **Price:** $0.20 / $0.60 per 1M tokens
- **Context window:** 32K tokens
- **Reasoning:** No
- **Best for:** EU-hosted inference, budget tasks needing European data residency
- **API:** `https://api.mistral.ai/v1` (direct, not via OpenRouter)

### Mistral Large (EU-native)

- **Model ID (via Mistral direct):** `mistral-large-latest`
- **Price:** $0.50 / $1.50 per 1M tokens
- **Context window:** 128K tokens
- **Reasoning:** No
- **Best for:** Higher-quality EU-hosted inference; GDPR-sensitive workloads
- **API:** `https://api.mistral.ai/v1` (direct, not via OpenRouter)

---

## Price Comparison (vs Anthropic)

| Model | Input /1M | Output /1M | vs Claude Opus |
|---|---|---|---|
| **Claude Opus 4.7** | $5.00 | $25.00 | baseline |
| **Claude Sonnet 4.6** | $3.00 | $15.00 | — |
| **Claude Haiku 4.5** | $1.00 | $5.00 | 5× cheaper |
| **DeepSeek V4 Flash** | $0.10 | $0.20 | **125× cheaper** |
| **DeepSeek V4 Pro** | $0.14 | $0.28 | **89× cheaper** |
| **Gemini 3 Flash** | $0.50 | $3.00 | 8× cheaper |
| **Mistral Small** | $0.20 | $0.60 | 40× cheaper |
| **Mistral Large** | $0.50 | $1.50 | 16× cheaper |

---

## Cost Optimisation Levers

### Prompt Caching (50–90% off input tokens)
OpenRouter passes through provider-level caching. Repeated static prefixes (system prompts, RAG context) can cost 10× less on cache hits. Enabled automatically on supported providers.

### Batch Processing (50% off)
OpenRouter and underlying providers offer batch APIs for non-real-time work (nightly jobs, document processing). Available via Together AI and others.

### Model Routing
Route simple/frequent tasks to DeepSeek V4 Flash, reserve V4 Pro only for complex multi-step work. A 90/10 split can reduce average cost by 60–80%.

---

## Model IDs Quick Reference

```
deepeek/deepseek-v4-flash
deepeek/deepseek-v4-pro
google/gemini-3-flash
google/gemini-3.1-pro
meta-llama/llama-3.3-70b-instruct
mistral-small-latest          (direct to api.mistral.ai)
mistral-large-latest          (direct to api.mistral.ai)
~anthropic/claude-sonnet-latest  (always newest Sonnet)
~anthropic/claude-opus-latest    (always newest Opus)
```

---

## Pricing Tracking Resources

- [LLM Cloud Hub](https://llmcloudhub.com/llm-pricing) — 56+ providers, refreshed nightly
- [Price Per Token](https://pricepertoken.com) — 300+ models
- [Sector HQ](https://www.sectorhq.co/llm-pricing) — 1,500+ models, 23 providers
- [Artificial Analysis](https://artificialanalysis.ai) — benchmarks + per-provider performance/price
- [OpenRouter Model Page](https://openrouter.ai/models) — live pricing with provider breakdown
