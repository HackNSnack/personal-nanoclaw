---
tags: [nanoclaw, opencode, openrouter, debugging, retry, deepseek]
type: reference
status: done
---

# OpenRouter 504 Upstream Idle Timeout — Retry Logic

**Symptom:** Claudette occasionally responds with:
```
Error: {"code":504,"message":"Upstream idle timeout exceeded","metadata":{"error_type":"timeout"}}
```
This error appeared frequently when using `deepseek/deepseek-v4-flash` via OpenRouter.

---

## Investigation

### Initial (Wrong) Hypothesis — Accumulated Context

First assumption: the 504 was caused by accumulated session history growing too large over time, making each DeepSeek turn progressively slower until it exceeded OpenRouter's timeout. This was based on the observation that the `ClaudeProvider` has a `maybeRotateContinuation` guard (rotates sessions when transcript exceeds ~12MB or 14 days) but `OpenCodeProvider` has no equivalent.

**This was wrong.** The agent itself confirmed it:

> *"This is my first turn in this conversation — I don't have any previous history here. My context is just what I loaded from my persistent config files… No conversation history exists yet — conversations/ was empty."*

### Correct Root Cause — Session Lifecycle

OpenCode sessions are **in-memory** inside the Docker container (`opencode serve` process). When the container is killed by the host sweep after 30 min idle (`ABSOLUTE_CEILING_MS = 30 * 60 * 1000` in `host-sweep.ts`), the server process dies and takes all sessions with it.

On next wake:
1. Container starts fresh, new `opencode serve` process (no sessions)
2. `continuation:opencode` is loaded from `outbound.db` (persisted session ID from previous run)
3. Provider tries `client.session.promptAsync({ path: { id: oldSessionId } })`
4. Server has no such session → error matching `STALE_SESSION_RE` → continuation cleared → fresh session
5. Agent: *"first turn, no history"*

**Sessions only accumulate within a single container's lifetime** (max 30 min idle). Between restarts it's always a clean slate.

### What Context the Agent Actually Sees Per Turn

Three sources, all re-built fresh each turn:

| Source | Content | Scope |
|--------|---------|-------|
| System instructions | `/app/CLAUDE.md` + `.claude-fragments/*.md` + `CLAUDE.local.md` — ~32KB total for `cli-with-mathipe` | Every turn |
| `<thread_history>` | Up to 20 prior Slack messages in the thread, fetched live from Slack API by `enrichWithThreadContext()` in `chat-sdk-bridge.ts:218` | Every turn, current thread only |
| OpenCode session | All turns sent since this container started (in-memory, dies with container) | Within container lifetime only |

The `maxMessagesPerPrompt` cap (default 10, `null` for `cli-with-mathipe`) only limits how many *new pending rows* are pulled from `inbound.db` per poll iteration — it does **not** limit total context.

### Why the 504 Actually Happens

The error JSON `{"code":504,"message":"Upstream idle timeout exceeded","metadata":{"error_type":"timeout"}}` originates at **OpenRouter's gateway**, not in our code. OpenRouter fires it when the upstream (DeepSeek's inference servers) stalls mid-generation — typically a reasoning model that thinks for a long time before emitting its first output token.

In our code it surfaces as a `session.error` SSE event (not from `promptAsync`), because:
- `promptAsync` returns OK (HTTP 200, prompt accepted)
- OpenRouter keeps the connection open
- DeepSeek stalls
- OpenRouter sends an SSE error event
- OpenCode emits `session.error` with the 504 payload
- `sessionErrorMessage()` stringifies it → `throw new Error(JSON.stringify(props.error))`
- poll-loop catches it → `log(\`Query error: ${errMsg}\`)` → user sees the JSON in Slack

Note: the message appears without any prefix in the user's Slack (not *"OpenCode promptAsync: ..."* or *"OpenCode: failed to create session: ..."*), which confirms it comes through the `session.error` path → `JSON.stringify(props.error)` branch of `sessionErrorMessage()`.

This is a known OpenRouter behaviour confirmed by a third-party fix merged 2026-06-12:
> *"OpenRouter ends a streaming turn with 'Upstream idle timeout exceeded' when the routed upstream stalls mid-generation. It arrives as a mid-stream SSE error after the HTTP response opened 200, so it reaches error handling with no status code and no documented/stable error code."*
> — [archestra-ai/archestra#5511](https://github.com/archestra-ai/archestra/issues/5511)

---

## Solution — Retry Logic in OpenCode Provider

Added retry logic to `container/agent-runner/src/providers/opencode.ts`. The implementation wraps the entire per-turn processing block (session create → `promptAsync` → SSE stream) in a labeled `for` loop.

### New Env Vars

| Variable | Default | Purpose |
|---|---|---|
| `OPENCODE_RETRY_ENABLED` | `true` | Master switch. Set to `false` to disable all retries. |
| `OPENCODE_RETRY_MAX_ATTEMPTS` | `3` | Max attempts per turn before giving up. |
| `OPENCODE_RETRY_BASE_DELAY_MS` | `1000` | Base backoff delay (ms), doubled each retry. |
| `OPENCODE_RETRY_MAX_DELAY_MS` | `60000` | Backoff ceiling (ms). |

All constants are read at module load time (not per-call), so changing them requires a container rebuild.

### Key Design Decisions

**`isRetryableError(err)`** — classifies errors before retrying:
- Retryable: `50x`, `timeout`, `Upstream idle timeout`, `ETIMEDOUT`, `ECONNRESET`, `deadline exceeded`, `event timeout`, `temporarily unavailable`
- Non-retryable (take precedence): `4xx` (except 428), `rate limit`, `429`, `model not found`, `ProviderModelNotFoundError`, `InvalidRequestError`, `AuthenticationError`, `PermissionError`

**`initYielded = false` on catch** — When retrying, the old session is dead. The new attempt creates a fresh OpenCode session with a new ID. Resetting `initYielded` forces a second `init` event to be emitted for the new session ID. The poll-loop overwrites the continuation in `outbound.db` each time it sees an `init` event, so the new session ID persists correctly for the next container wake.

**`self.activeSessionId = undefined` on catch** — Ensures the retry creates a fresh session rather than retrying on the dead session that just timed out.

**The SSE stream is shared across sessions.** After a `session.error` for session A, the stream continues emitting events. When we create session B for the retry, events from the stream are filtered by `sessionId` in all switch cases, so stale session A events are ignored cleanly.

**`_sleepFn` injectable** — The sleep implementation is exposed via `_setSleepForTest()` so tests can replace it with a no-op, avoiding real delays.

**`_setRuntimeForTest()` injectable** — The shared runtime (OpenCode server + client + stream) is injectable via `_setRuntimeForTest()`, which sets `sharedConfigKey` to `runtimeConfigKey({})` — matching what `ensureSharedRuntime()` computes — so the test mock is picked up instead of attempting to `spawnOpencodeServer`.

### Retry Loop Structure

```typescript
const maxAttempts = RETRY_ENABLED ? RETRY_MAX_ATTEMPTS : 1;

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  if (attempt > 1) {
    await _sleepFn(retryDelay(attempt));  // exponential backoff + jitter
    log(`Turn error — retrying (attempt ${attempt}/${maxAttempts}, backoff ${delay}ms)`);
  }

  try {
    // session.create if needed
    // yield init (if !initYielded)
    // promptAsync → throw on error
    // SSE event loop → throw on session.error / timeout
    // yield result
    break;  // success
  } catch (err) {
    self.activeSessionId = undefined;
    initYielded = false;

    const willRetry = isRetryableError(err) && attempt < maxAttempts && !aborted;
    if (!willRetry) throw err;  // permanent or exhausted
    log(`Turn error (attempt ${attempt}/${maxAttempts}): ${err.message}`);
  }
}
```

### Backoff Formula

`retryDelay(attempt, baseMs?, maxMs?)` — attempt 1 = 0, attempt 2 = base, attempt 3 = 2×base, etc., clamped at maxMs, plus 0–30% random jitter. Optional `baseMs`/`maxMs` params allow tests to pass fixed values without touching module-level constants.

---

## Tests

New file: `container/agent-runner/src/providers/opencode.retry.test.ts`

28 tests, all passing. Coverage:

**`isRetryableError` (15 tests)**
- Various retryable patterns (504, Upstream idle timeout, 5xx, ETIMEDOUT, ECONNRESET, deadline exceeded, event timeout, temporarily unavailable)
- Various non-retryable patterns (401, 403, 400, 404, 429, model not found, ProviderModelNotFoundError)
- Edge cases: `null`, `undefined`, empty string, plain strings (non-Error)

**`retryDelay` (5 tests)**
- attempt 1 → 0
- attempt 2 → in range `[base, base * 1.3]`
- attempt 3 → doubles base
- clamped by maxMs
- never exceeds maxMs + 30% jitter across 10 attempts

**Retry behaviour (8 tests)** — driven via `_setRuntimeForTest` with mock `session.create` / `promptAsync` and a controlled SSE stream generator:
- Succeeds on first attempt without retrying (1 `init` event)
- Retries once after 504 from `promptAsync`, succeeds on second (2 `init` events)
- Retries after `session.error` 504 from SSE stream, succeeds on second
- Does NOT retry a non-retryable 401 (throws immediately)
- Exhausts all 3 attempts and throws when every attempt returns 504
- Creates a fresh `session.create` call for each retry attempt (count verified)
- Clears `activeSessionId` between attempts (3 distinct session IDs in `init` events)
- Succeeds on second attempt after stream-level `session.error`

---

## Timeout Investigation — Can the OpenRouter Timeout Be Increased?

**Short answer: no, not from the client side.**

Checked the official OpenRouter provider routing documentation at [openrouter.ai/docs/guides/routing/provider-selection](https://openrouter.ai/docs/guides/routing/provider-selection.mdx). The full set of fields in the `provider` object:

`order`, `allow_fallbacks`, `require_parameters`, `data_collection`, `zdr`, `enforce_distillable_text`, `only`, `ignore`, `quantizations`, `sort`, `preferred_min_throughput`, `preferred_max_latency`, `max_price`

**There is no `timeout` field.** The 504 is issued by OpenRouter's infrastructure when the upstream stalls — it is not configurable per-request.

Note: the earlier suggestion in this session to use `OPENCODE_OPENROUTER_ROUTING={"timeout": 120}` was a hallucination. That field does not exist.

### What CAN Be Configured

`OPENCODE_OPENROUTER_ROUTING` (already wired in `buildOpenCodeConfig()`) accepts any valid `provider` routing object. Useful options that *do* exist:

```bash
# Prioritise fastest DeepSeek endpoint by throughput (reduces timeout frequency)
OPENCODE_OPENROUTER_ROUTING={"sort": "throughput"}

# Or prefer low latency endpoints (5-minute rolling window)
OPENCODE_OPENROUTER_ROUTING={"preferred_max_latency": {"p90": 30}}
```

These can reduce *how often* the timeout fires by routing to better-performing DeepSeek nodes, but they cannot prevent it entirely. The retry logic handles the remaining cases.

`OPENCODE_IDLE_TIMEOUT_MS` (our own SSE event-stream idle timeout, default 300000ms = 5 min) is unrelated — it fires only if the OpenCode SSE stream goes completely silent, not when OpenRouter returns a 504.

### Recommended `.env` Settings

```bash
# Retry on transient 504s (already the default)
OPENCODE_RETRY_ENABLED=true
OPENCODE_RETRY_MAX_ATTEMPTS=3

# Optional: steer OpenRouter toward faster DeepSeek nodes
# OPENCODE_OPENROUTER_ROUTING={"sort": "throughput"}
```

---

## Files Changed

| File | Change |
|---|---|
| `container/agent-runner/src/providers/opencode.ts` | Added `RETRY_ENABLED`, `RETRY_MAX_ATTEMPTS`, `RETRY_BASE_DELAY_MS`, `RETRY_MAX_DELAY_MS` constants; `isRetryableError()`, `sleep()`, `retryDelay()` exported functions; `_setSleepForTest()` + `_setRuntimeForTest()` test hooks; `SharedRuntime` exported; retry loop in `gen()`; `_setRuntimeForTest` uses `runtimeConfigKey({})` for correct key matching |
| `container/agent-runner/src/providers/opencode.retry.test.ts` | New — 28 tests |

---

## References

- [OpenRouter Provider Routing Docs](https://openrouter.ai/docs/guides/routing/provider-selection.mdx) — Full list of valid `provider` fields
- [archestra-ai/archestra#5511](https://github.com/archestra-ai/archestra/issues/5511) — Third-party confirmation: "Upstream idle timeout exceeded" is a mid-stream SSE error, retryable, no stable error code
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/OpenCode + OpenRouter Configuration]]
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/OpenCode ProviderModelNotFoundError — Stale Session Loop]]
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/DeepSeek Missing Closing Tag — Silent Response Drop]]
