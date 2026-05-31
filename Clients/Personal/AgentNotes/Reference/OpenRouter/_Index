# OpenRouter — Reference Index

Evergreen reference documentation for using OpenRouter as a cheap LLM inference layer, integrated with pi.

---

## Documents

1. [[Clients/Personal/AgentNotes/Reference/OpenRouter/00 - Overview]] — What OpenRouter is, why to use it, key concepts, pricing & fees, privacy
2. [[Clients/Personal/AgentNotes/Reference/OpenRouter/01 - Routing Mechanism]] — Layer 1 (provider routing) and Layer 2 (model routing) in full detail
3. [[Clients/Personal/AgentNotes/Reference/OpenRouter/02 - Providers]] — Which providers to whitelist/avoid, geography, data retention policies
4. [[Clients/Personal/AgentNotes/Reference/OpenRouter/03 - Models & Pricing]] — Recommended models, pricing table vs Anthropic, cost optimisation levers
5. [[Clients/Personal/AgentNotes/Reference/OpenRouter/04 - Pi Integration]] — Full `models.json` config, `openRouterRouting` compat field, field reference
6. [[Clients/Personal/AgentNotes/Reference/OpenRouter/05 - Work vs Personal Setup]] — Two-level settings system, global vs project config, in-session switching

---

## Quick Reference

### Recommended Provider Whitelist (US, zero retention)
```
deepeinfra, parasail, fireworks, together, digital-ocean, akashml
```

### Providers to Always Exclude
```
deepeseek (CN, trains on prompts), siliconflow (CN), baidu-qianfan (CN), alibaba (SG)
```

### Key Model IDs
```
deepeek/deepseek-v4-flash      — primary cheap model
deepeek/deepseek-v4-pro        — heavy reasoning
google/gemini-3-flash           — 1M context
mistral-small-latest            — EU-native (direct to api.mistral.ai)
mistral-large-latest            — EU-native (direct to api.mistral.ai)
```

### Key `openRouterRouting` Fields
```json
{
  "only": ["..."],          // Whitelist — prefer over ignore
  "sort": "price",          // or "throughput", "latency"
  "data_collection": "deny",
  "quantizations": ["fp8", "fp16", "bf16"],
  "max_price": { "prompt": 0.20, "completion": 0.40 }
}
```

### Costs (approximate, verify at openrouter.ai)
| Model | Input | Output |
|---|---|---|
| DeepSeek V4 Flash | $0.10/1M | $0.20/1M |
| DeepSeek V4 Pro | $0.14/1M | $0.28/1M |
| Gemini 3 Flash | $0.50/1M | $3.00/1M |
| Mistral Small | $0.20/1M | $0.60/1M |
| Claude Sonnet 4.6 | $3.00/1M | $15.00/1M |
| Claude Opus 4.7 | $5.00/1M | $25.00/1M |

---

## External Links

- [OpenRouter Models](https://openrouter.ai/models)
- [OpenRouter Docs — Routing](https://openrouter.ai/docs/provider-routing)
- [OpenRouter Activity](https://openrouter.ai/activity)
- [Pi models.md docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md)
- [Artificial Analysis — Provider Benchmarks](https://artificialanalysis.ai/models/deepseek-v4-flash/providers)
- [Price Per Token](https://pricepertoken.com)
