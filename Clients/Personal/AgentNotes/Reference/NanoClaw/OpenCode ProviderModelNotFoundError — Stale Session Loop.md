---
tags: [nanoclaw, opencode, debugging, runbook, openrouter]
type: reference
status: active
---

# OpenCode `ProviderModelNotFoundError` — Stale Session Loop

**Symptom:** The bot replies with `Error: Model not found: <model-id>` on every message, with no agent output.

**First documented:** 2026-06-11
**Affects:** NanoClaw installs using the `opencode` provider.

---

## Quick Fix

```bash
# 1. Clear the stale OpenCode session continuation (if error persists across restarts)
SESS_DIR=$(ls -td data/v2-sessions/ag-*/sess-* | head -1)
sqlite3 "$SESS_DIR/outbound.db" \
  "DELETE FROM session_state WHERE key = 'continuation:opencode';"

# 2. Confirm source code fixes are applied (no container rebuild needed — source is a live mount)
grep "model not found" container/agent-runner/src/providers/opencode.ts
# Should print the STALE_SESSION_RE line

grep "providerModels" container/agent-runner/src/providers/opencode.ts
# Should print the models registration block

# 3. Restart — bot will start a fresh session
systemctl --user restart nanoclaw-v2-a72e394a
```

---

## Root Causes

Two independent bugs produce this error. Either or both may be active.

### Bug A — Model not in OpenCode's bundled registry

**Error message:** `Error: Model not found: openrouter/deepseek/deepseek-v4-pro`

OpenCode ships with a frozen model registry baked into its binary. Models newer than the OpenCode release are absent. The lookup fails **before any API call** — this is a purely local failure.

**OpenCode v1.4.17 does not include `deepseek-v4-pro`** (latest it knows is `deepseek-v3.2`).

**Fix (already applied):** `buildOpenCodeConfig()` in `container/agent-runner/src/providers/opencode.ts` now explicitly registers the model in the `provider.<id>.models` block. This bypasses the bundled-list check:

```typescript
// modelSlug strips the 'openrouter/' prefix to get the bare slug
const mainSlug = modelSlug(provider, model);   // e.g. 'deepseek/deepseek-v4-pro'
if (mainSlug) providerModels[mainSlug] = {};
```

The generated OpenCode config contains:
```json
"openrouter": {
  "models": { "deepseek/deepseek-v4-pro": {} },
  ...
}
```

This is automatic for any `OPENCODE_MODEL` value — no manual work needed when switching models.

---

### Bug B — Wrong model ID format (missing `openrouter/` prefix)

**Error message:** `Error: Model not found: deepseek/deepseek-v4-pro` (no `openrouter/` prefix)

OpenCode parses the top-level `model` config key as `provider_id/model_id`. If the value is `deepseek/deepseek-v4-pro`, OpenCode reads provider = `deepseek`, model = `deepseek-v4-pro`. Since no `deepseek` provider is configured (only `openrouter` is), the lookup fails.

**Fix (already applied):** `.env` must use the fully-qualified form:
```bash
OPENCODE_MODEL=openrouter/deepseek/deepseek-v4-pro
```

The `fullyQualifiedModel()` helper in `buildOpenCodeConfig()` also auto-prepends the prefix if missing, so both forms in `.env` work.

---

### Bug C — Stale `continuation:opencode` session ID

**How it appears:** Error recurs on every single message, including fresh ones. The container log shows `Resuming agent session ses_XXXXXXXX` immediately followed by the model-not-found error.

When a container restarts mid-session, the poll-loop persists the OpenCode session ID to `outbound.db` so it can resume. If that session was corrupted (e.g. the model was changed between runs, or the opencode-xdg volume was wiped), every subsequent start immediately fails trying to resume the dead session.

**Fix:** Delete the stale row. The `STALE_SESSION_RE` regex in `opencode.ts` now matches both `model not found` and `ProviderModelNotFoundError`, so in most cases the poll-loop clears the continuation automatically on the next error. If it doesn't clear itself:

```bash
sqlite3 data/v2-sessions/<group>/<session>/outbound.db \
  "DELETE FROM session_state WHERE key = 'continuation:opencode';"
```

---

## Diagnostic Playbook

### Step 1 — Confirm the error source

```bash
# Check if it's a container-level error (most likely)
CONTAINER=$(docker ps --filter "name=nanoclaw-v2" --format "{{.Names}}" | head -1)
docker logs "$CONTAINER" 2>&1 | grep -E "error|Error|Resuming" | tail -20
```

Key signals:
- `Resuming agent session` + `Model not found` → Bug C (stale continuation)
- `Starting fresh session` + `Model not found` → Bug A or B (model not registered / wrong prefix)

### Step 2 — Check which model ID OpenCode received

```bash
# The OPENCODE_CONFIG_CONTENT env var is what opencode actually sees
CONTAINER=$(docker ps --filter "name=nanoclaw-v2" --format "{{.Names}}" | head -1)
docker exec "$CONTAINER" printenv OPENCODE_CONFIG_CONTENT | python3 -m json.tool | grep -A5 '"model"'
```

Red flags:
- `"model": "deepseek/deepseek-v4-pro"` (no `openrouter/` prefix) → Bug B
- No `"models"` block under `openrouter` → Bug A
- `"providerID": "deepseek"` in error → Bug B

### Step 3 — Check outbound.db for stale continuation

```bash
find data/v2-sessions -name outbound.db | while read db; do
  echo "=== $db ==="
  sqlite3 "$db" "SELECT key, value FROM session_state;"
done
```

If you see `continuation:opencode | ses_XXXXXXXX` and the agent keeps failing on resume → delete that row (see Quick Fix above).

### Step 4 — Verify the bundled model list

```bash
docker run --rm --entrypoint bash nanoclaw-agent-v2-a72e394a:latest -c \
  'strings /pnpm/global/5/.pnpm/opencode-ai@1.4.17/node_modules/opencode-linux-x64/bin/opencode \
   | grep -o "deepseek/deepseek[^\"]*" | sort -u'
```

If `deepseek-v4-pro` does not appear, the explicit `models:` registration in `buildOpenCodeConfig()` is required (and already in place).

---

## Code Changes Applied (2026-06-11)

All changes are in `container/agent-runner/src/providers/opencode.ts`. Source is a live bind-mount — **no container rebuild needed**.

### 1. `fullyQualifiedModel()` helper — auto-prefix model IDs

```typescript
function fullyQualifiedModel(provider: string, rawModel: string | undefined): string | undefined {
  if (!rawModel) return undefined;
  if (provider === 'anthropic') return rawModel;
  if (rawModel.startsWith(`${provider}/`)) return rawModel;
  return `${provider}/${rawModel}`;
}
```

### 2. `modelSlug()` helper — extract bare slug for models: registration

```typescript
function modelSlug(provider: string, qualifiedModel: string | undefined): string | undefined {
  if (!qualifiedModel) return undefined;
  if (provider !== 'anthropic' && qualifiedModel.startsWith(`${provider}/`))
    return qualifiedModel.slice(provider.length + 1);
  return qualifiedModel;
}
```

### 3. Explicit `models:` block in provider config

```typescript
const providerModels: Record<string, unknown> = {};
const mainSlug = modelSlug(provider, model);
const smallSlug = modelSlug(provider, smallModel);
if (mainSlug) providerModels[mainSlug] = {};
if (smallSlug) providerModels[smallSlug] = {};

// Added to provider options:
...(Object.keys(providerModels).length > 0 ? { models: providerModels } : {})
```

### 4. Extended `STALE_SESSION_RE`

```typescript
const STALE_SESSION_RE =
  /no conversation found|ENOENT.*\.jsonl|session.*not found|NotFoundError|connection reset|ECONNRESET|404|event timeout|model not found|ProviderModelNotFoundError/i;
```

---

## Related

- [[Clients/Personal/AgentNotes/Reference/NanoClaw/OpenCode + OpenRouter Configuration]] — full architecture, OneCLI auth, model format
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/NanoClaw Operations]] — start/stop, logs
