# OpenRouter — Work vs Personal Setup

Pi uses a two-level settings system that makes it straightforward to default to Anthropic for work and OpenRouter for personal use, without any manual switching.

---

## The Two-Level System

| File | Scope | Merging |
|---|---|---|
| `~/.pi/agent/settings.json` | Global — applies to every directory | Base config |
| `.pi/settings.json` | Project-level — applies only in that directory | Overrides/merges into global |

Nested objects are **merged, not replaced** — you only need to specify what you want to override at the project level. Everything else inherits from global.

---

## Configuration

### Global (`~/.pi/agent/settings.json`) — Default to Anthropic

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium",
  "enabledModels": [
    "claude-*",
    "DeepSeek V4 Flash*",
    "DeepSeek V4 Pro*",
    "Gemini 3 Flash*",
    "Mistral*"
  ]
}
```

The `enabledModels` list controls which models appear in the **Ctrl+P quick-cycle** shortcut, so you're not scrolling through every OpenRouter model. Patterns use glob syntax and match against model `name` fields.

### Personal Project (`.pi/settings.json`) — Default to OpenRouter

Place this file inside any directory used for personal work:

```json
{
  "defaultProvider": "openrouter",
  "defaultModel": "deepseek/deepseek-v4-flash"
}
```

Only these two fields are needed — everything else (theme, compaction, retry settings etc.) continues to inherit from global.

---

## How It Works in Practice

| Where you run pi | Default model | Why |
|---|---|---|
| Any work project directory | Claude Sonnet (Anthropic) | Global `settings.json` |
| Any personal project directory | DeepSeek V4 Flash (OpenRouter) | `.pi/settings.json` in that directory |
| Any session, any time | Switch to anything | `/model` command or Ctrl+P |

Pi detects the `.pi/settings.json` automatically based on the working directory when it starts — no flags, no env vars, no aliases needed.

---

## In-Session Model Switching

Regardless of the default, you can always switch mid-session:

- **`/model`** — opens the full model picker (shows all models from `models.json` + built-ins)
- **Ctrl+P** — cycles through models in your `enabledModels` list
- **`--model <id>`** at startup — overrides the default for that session
- **`--model <id>:<thinking>`** — override model and thinking level together (e.g. `--model deepseek/deepseek-v4-flash:high`)

---

## Alternative: CLI Flags (One-off Overrides)

For occasional use without any config change:

```bash
# Use OpenRouter model for one session, regardless of directory defaults
pi --model deepseek/deepseek-v4-flash "help me with this"

# With a specific thinking level
pi --model deepseek/deepseek-v4-flash:high "solve this hard problem"
```

---

## Alternative: Full Profile Isolation (`PI_CODING_AGENT_DIR`)

For complete separation (separate sessions, settings, keys):

```bash
# ~/.zshrc
export OPENROUTER_API_KEY="sk-or-v1-..."
alias pi-work='pi'                                            # Uses ~/.pi/agent (Anthropic)
alias pi-personal='PI_CODING_AGENT_DIR=~/.pi/agent-personal pi'  # Fully separate config dir
```

This is heavier than needed for most cases — the project-level `.pi/settings.json` approach is simpler and sufficient.

---

## Related

- [[Clients/Personal/AgentNotes/Reference/OpenRouter/04 - Pi Integration]] — Full `models.json` config
- [[Clients/Personal/AgentNotes/Reference/OpenRouter/02 - Providers]] — Provider whitelist reference
- [Pi docs — Settings](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md)
- [Pi docs — Usage / CLI flags](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/usage.md)

---

## `enabledModels` Glob vs Exact ID Matching

`enabledModels` patterns match against both model **names** (`name` field in `models.json`) and **model IDs** (`id` field). This dual matching can cause unintended inclusions.

### Short Glob → Overmatching

A pattern like `"deepseek-v4-flash"` is a substring/glob that matches:
- Model name `"DeepSeek V4 Flash (OpenRouter)"` ← your paid entry
- Model ID `deepseek/deepseek-v4-flash:free` ← built-in free variant

Both appear in Ctrl+P cycling. The free variant hits `429 Rate Limited` if not on a paid OpenRouter plan.

### Exact ID → Precision

Use the full provider-prefixed ID to exclude free variants:

```json
"enabledModels": [
  "deepseek/deepseek-v4-flash",    // Only the paid one
  "deepseek/deepseek-v4-pro"
]
```

A glob with `*` suffix (`"DeepSeek V4 Flash*"`) still matches both because it matches the `name` field of the free variant. Only the exact ID string guarantees no free-variant match.
