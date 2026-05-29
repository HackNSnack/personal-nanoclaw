# 12 — Model Registry & Resolution

## Summary

The `ModelRegistry` (~845 LOC) manages all available models from built-in definitions, `models.json` configuration, and extension-registered providers. It handles model lookup, provider registration/unregistration, API key resolution, and OAuth credential management. The `model-resolver.ts` handles CLI model pattern matching and scoped model resolution for Ctrl+P cycling.

## Key Types & Interfaces

### Model Registry (`core/model-registry.ts`)

| Type | Description |
|---|---|
| `ModelRegistry` | Central class. Methods: `create()`, `getAll()`, `find(provider, id)`, `findByPattern(pattern)`, `registerProvider()`, `unregisterProvider()`, `getApiKey(provider)`, `setApiKey(provider, key)` |
| `RegisteredProvider` | `{name, models: Model[], config: ProviderConfig, source: "builtin" \| "config" \| "extension"}` |

### Model Resolution (`core/model-resolver.ts`)

| Type | Description |
|---|---|
| `ScopedModel` | `{model: Model, thinkingLevel?: ThinkingLevel}` — model + optional thinking override |
| `CliModelResolution` | `{model?, thinkingLevel?, warning?, error?}` |

### Config-based Models (`models.json`)

```json
{
  "my-provider": {
    "baseUrl": "https://api.example.com/v1",
    "apiKey": "env:MY_API_KEY",
    "api": "openai-completions",
    "models": [
      {
        "id": "my-model",
        "name": "My Model",
        "reasoning": false,
        "input": ["text", "image"],
        "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
        "contextWindow": 128000,
        "maxTokens": 4096
      }
    ]
  }
}
```

Value resolution for `apiKey`, `baseUrl`, `headers`:
- `env:VAR_NAME` → environment variable
- `file:/path` → file contents
- `cmd:command` → command output
- Plain string → literal value

## Flow

### Model Registry Construction

```
ModelRegistry.create(authStorage, modelsJsonPath?):
  1. Load built-in models from models.generated.ts (~250+ models)
  2. Load models.json if it exists
     a. Parse JSON
     b. Resolve values (env:, file:, cmd:)
     c. Create Model objects with resolved baseUrl, headers
  3. Register all providers
  4. Return registry
```

### Built-in Models

Generated from `ai/src/models.generated.ts` — a large file with all known models across providers. Each model has:
- `id`, `name`, `api`, `provider`, `baseUrl`
- `reasoning` (boolean), `input` types, `cost` per token
- `contextWindow`, `maxTokens`

### API Key Resolution

```
modelRegistry.getApiKey(provider):
  1. Runtime API key (set via SDK or --api-key)
  2. Auth storage (persisted API keys)
  3. Environment variable (e.g., ANTHROPIC_API_KEY)
  4. OAuth token (from /login)
  5. undefined (no key available)
```

### CLI Model Resolution

```
resolveCliModel({cliProvider, cliModel, modelRegistry}):
  Parse pattern: "provider/model-pattern:thinking"
  Examples:
    "sonnet"           → fuzzy match across all providers
    "anthropic/sonnet"  → match within anthropic
    "sonnet:high"       → model + thinking level
    "o4-mini"           → matches openai o4-mini

  1. Split on ":" for thinking suffix
  2. Split on "/" for provider prefix
  3. If provider specified: search only that provider
  4. Fuzzy match: model ID contains pattern (case-insensitive)
  5. Prefer exact matches, then reasoning models
  6. Return {model, thinkingLevel?, warning?}
```

### Scoped Models (Ctrl+P cycling)

```
resolveModelScope(patterns, modelRegistry):
  For each pattern in --models or settings.scopedModels:
    resolveCliModel(pattern)
  Return: ScopedModel[] with model + thinkingLevel

At runtime:
  Ctrl+P / Ctrl+Shift+P: cycle through scopedModels
  If no scopedModels: cycle through all available models
```

### Extension Provider Registration

```
pi.registerProvider("my-proxy", {
  baseUrl: "https://proxy.example.com",
  api: "anthropic-messages",
  apiKey: "PROXY_KEY",
  models: [
    {id: "claude-sonnet-4", name: "Sonnet (proxy)", ...}
  ],
  oauth: {...}  // optional
});

During load phase: queued in pendingProviderRegistrations
After bindCore(): immediate effect via modelRegistry.registerProvider()
```

### Unregistration

```
pi.unregisterProvider("my-proxy"):
  Remove all models from that provider
  Restore any built-in models that were overridden
```

## Integration Points

| Connects to | How |
|---|---|
| **Bootstrap (doc 01)** | ModelRegistry created during services; CLI model resolution |
| **AI Provider (doc 02)** | Models carry `api` field that selects the stream function |
| **Agent Session (doc 04)** | Session uses registry for API key resolution, model cycling |
| **Extension System (doc 06)** | `registerProvider()` / `unregisterProvider()` from extensions |
| **Modes (doc 10)** | Model selector in interactive mode; Ctrl+P cycling |

## Extension Relevance

- **Custom models**: Add models via `~/.pi/agent/models.json` or `pi.registerProvider()`.
- **Provider proxy**: Override built-in provider URL: `pi.registerProvider("anthropic", {baseUrl: "https://proxy.example.com"})`.
- **OAuth providers**: Register `oauth: {login, refreshToken, getApiKey}` for `/login` support.
- **Dynamic models**: Extensions can register/unregister providers at any time after bind phase.
- **API key access**: `ctx.modelRegistry` in event handlers provides model discovery and key resolution.
- **Model selection event**: `model_select` event fires when model changes (via UI, CLI, or extension).
- **`pi.setModel(model)`**: Programmatically switch model. Returns false if no API key available.

## Open Questions

1. **Model discovery latency**: All 250+ built-in models are loaded at startup. Is this a performance concern?
2. **Config value resolution**: `cmd:` values run a subprocess. Is this sandboxed? Could be a security concern for shared configs.
3. **Provider override semantics**: When an extension overrides "anthropic", does it replace all Anthropic models or just add new ones?

## Key Files Read

| File | Lines | Purpose |
|---|---|---|
| `coding-agent/src/core/model-registry.ts` | 845 | Model registry, provider management |
| `coding-agent/src/core/model-resolver.ts` | ~200 | CLI model resolution, scoped models |
| `coding-agent/src/core/auth-storage.ts` | ~150 | API key persistence |
| `ai/src/models.generated.ts` | ~5,000 | Built-in model definitions |
| `ai/src/models.ts` | 82 | Model utility functions |
