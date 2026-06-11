---
tags: [nanoclaw, opencode, openrouter, onecli, configuration]
type: reference
status: active
---

# OpenCode + OpenRouter Configuration

How the `opencode` provider works inside NanoClaw containers, how OneCLI injects credentials, and what can go wrong.

**Last updated:** 2026-06-11

---

## Architecture Overview

```
.env (host)
  OPENCODE_PROVIDER=openrouter
  OPENCODE_MODEL=openrouter/deepseek/deepseek-v4-pro
  ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1

          │
          ▼
  src/providers/opencode.ts   (host-side, runs at container spawn)
  ─────────────────────────────────────────────────────────────────
  • Reads OPENCODE_PROVIDER, OPENCODE_MODEL, OPENCODE_SMALL_MODEL
  • Always sets OPENROUTER_API_KEY = real key (if in .env) or 'onecli-managed' sentinel
  • Mounts opencode-xdg/ dir at /opencode-xdg (XDG_DATA_HOME)
  • Does NOT set bypassOnecli → OneCLI HTTPS proxy is applied

          │  container-runner.ts → onecli.applyContainerConfig()
          │  • Injects HTTPS_PROXY pointing at host.docker.internal:10255
          │  • Injects OneCLI TLS certificate
          ▼

  container/agent-runner/src/providers/opencode.ts → buildOpenCodeConfig()
  ─────────────────────────────────────────────────────────────────
  • Spawns `opencode serve` with OPENCODE_CONFIG_CONTENT env var (JSON)
  • Config includes: model, small_model, enabled_providers, provider options

          │
          ▼
  opencode native binary (v1.4.17)
  → HTTP POST https://openrouter.ai/api/v1/…
    Authorization: Bearer onecli-managed
          │
          ▼  HTTPS_PROXY → OneCLI proxy (172.17.0.1:10255)
             Matches host pattern 'openrouter.ai'
             Replaces header with real OpenRouter key from vault
          │
          ▼
  openrouter.ai  ✓
```

---

## Key Concept: OneCLI Bearer Sentinel

NanoClaw never stores the real API key inside the container. Instead:

1. Host-side `src/providers/opencode.ts` always sets `OPENROUTER_API_KEY` to either the real key (if present in `.env`) or the string `'onecli-managed'`.
2. Inside the container, `buildOpenCodeConfig()` reads that env var and passes it as `options.apiKey` in the OpenCode config.
3. OpenCode sends every request with `Authorization: Bearer onecli-managed`.
4. `HTTPS_PROXY` routes the request through OneCLI, which has a registered secret for host pattern `openrouter.ai`.
5. OneCLI replaces the placeholder with the real key before forwarding.

This is the same pattern as the `claude` provider (`ANTHROPIC_AUTH_TOKEN=placeholder`).

> ⚠️ If `OPENROUTER_API_KEY` is absent or empty in the container, OpenCode sends no `Authorization` header. OneCLI has nothing to replace → OpenRouter returns 401.

---

## Model ID Format

OpenCode's top-level `model` config key requires the **fully-qualified** format `provider_id/model_id`. For OpenRouter:

```
openrouter/deepseek/deepseek-v4-pro
└──────┘  └────────────────────────┘
provider     model_id (OpenRouter slug)
```

**`.env` must use the full qualified form:**
```bash
OPENCODE_MODEL=openrouter/deepseek/deepseek-v4-pro
OPENCODE_SMALL_MODEL=openrouter/deepseek/deepseek-v4-flash
```

The `fullyQualifiedModel()` helper in `buildOpenCodeConfig()` auto-prepends the provider prefix if it is missing, so `deepseek/deepseek-v4-pro` also works — but the explicit form is clearer and less surprising.

---

## Bundled Model List Problem

OpenCode ships with a **frozen model registry** (sourced from models.dev) baked into its native binary. Models released after the OpenCode release date are absent from this registry. Requesting an unknown model throws `ProviderModelNotFoundError` **before any API call is made** — purely a local lookup failure.

**OpenCode v1.4.17 knows DeepSeek up to `deepseek-v3.2`. It does NOT include `deepseek-v4-pro`.**

To check what the installed binary knows:
```bash
docker run --rm --entrypoint bash nanoclaw-agent-v2-a72e394a:latest -c \
  'strings /pnpm/global/5/.pnpm/opencode-ai@1.4.17/node_modules/opencode-linux-x64/bin/opencode \
   | grep -o "deepseek/deepseek[^\"]*" | sort -u'
```

### Fix: explicit `models:` registration

`buildOpenCodeConfig()` extracts the bare slug from `OPENCODE_MODEL` and adds it to `provider.<id>.models`. This tells OpenCode to trust the model ID without checking the bundled list:

```json
{
  "model": "openrouter/deepseek/deepseek-v4-pro",
  "enabled_providers": ["openrouter"],
  "provider": {
    "openrouter": {
      "models": {
        "deepseek/deepseek-v4-pro": {},
        "deepseek/deepseek-v4-flash": {}
      },
      "options": {
        "apiKey": "onecli-managed",
        "baseURL": "https://openrouter.ai/api/v1"
      }
    }
  }
}
```

This is automatic — any model set via `OPENCODE_MODEL` or `OPENCODE_SMALL_MODEL` is registered. No manual config changes needed when switching models.

---

## Relevant Source Files

| File | Role |
|---|---|
| `.env` | `OPENCODE_PROVIDER`, `OPENCODE_MODEL`, `OPENCODE_SMALL_MODEL`, `ANTHROPIC_BASE_URL` |
| `src/providers/opencode.ts` | Host-side: mounts opencode-xdg, passes env vars, always sets `OPENROUTER_API_KEY` |
| `container/agent-runner/src/providers/opencode.ts` | Container-side: `buildOpenCodeConfig()`, `fullyQualifiedModel()`, `modelSlug()`, bearer sentinel |
| `container/Dockerfile` | `ARG OPENCODE_VERSION=1.4.17` — bump here to upgrade |

---

## Upgrading OpenCode

When upgrading OpenCode (to pick up newer bundled models or fixes):

1. Update `ARG OPENCODE_VERSION` in `container/Dockerfile`.
2. Rebuild: `cd container && ./build.sh`
3. Verify the target model is now bundled:
   ```bash
   docker run --rm --entrypoint bash nanoclaw-agent-v2-a72e394a:latest -c \
     'strings /pnpm/.../opencode-linux-x64/bin/opencode | grep "deepseek-v4-pro"'
   ```
4. The explicit `models:` registration in `buildOpenCodeConfig()` is harmless if the model is also bundled — no need to remove it.

---

## New Machine Checklist

On a fresh install with `OPENCODE_PROVIDER=openrouter`:

- [ ] `OPENCODE_MODEL=openrouter/<slug>` in `.env` (with `openrouter/` prefix)
- [ ] `ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1` in `.env`
- [ ] OneCLI secret registered: `onecli secrets create --name OpenRouter --type anthropic --value sk-or-… --host-pattern openrouter.ai`
- [ ] Container image built: `./container/build.sh` (includes opencode binary)
- [ ] OneCLI proxy reachable from containers (port 10255 bound to `0.0.0.0`, not `127.0.0.1`)

---

## Troubleshooting

### `Error: Model not found: <model-id>`

OpenCode's local registry does not recognise the model. Causes:
- Missing `openrouter/` prefix in `OPENCODE_MODEL` (the bare `/` is misread as provider separator)
- Model too new for bundled list — handled automatically by `buildOpenCodeConfig()` explicit registration
- Wrong `OPENCODE_PROVIDER` value

### `Error: OpenRouter API key is missing`

No `apiKey` reached OpenCode. Check:
- `src/providers/opencode.ts` (host-side) must always set `OPENROUTER_API_KEY`
- Quick verify: `grep OPENROUTER_API_KEY src/providers/opencode.ts`

### `401 Unauthorized` from OpenRouter

OneCLI is not replacing the bearer sentinel:
- Is the OneCLI gateway running? `docker ps | grep onecli`
- Is the secret registered? `onecli secrets list`
- Can containers reach the proxy? See NanoClaw Operations for docker bridge binding fix.

### `ProviderModelNotFoundError` on session resume (stale loop)

The `STALE_SESSION_RE` regex in `opencode.ts` catches this error and clears the continuation automatically:
```
/…|model not found|ProviderModelNotFoundError/i
```
The next message starts a fresh session.

---

## Related

- [[Clients/Personal/AgentNotes/Reference/NanoClaw/NanoClaw Operations]]
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/OpenCode ProviderModelNotFoundError — Stale Session Loop]]
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/NanoClaw NixOS Setup]]
