# Ollama Qwen3.6-35B Investigation - Technical Findings

**Date:** 2026-04-24

This document catalogues every technical finding from the investigation, with reproduction steps.

---

## Finding 1: Ollama's `PARAMETER think` Is Not Supported

**Severity:** Blocker for Modelfile-based thinking control

**Reproduction:**
```
# Modelfile
FROM batiai/qwen3.6-35b:q4
PARAMETER think false
```

```bash
ollama create test -f Modelfile
# Error: unknown parameter 'think'
```

**Root Cause:** In Ollama's source code (`api/types.go`), `Think` lives on `ChatRequest` and `GenerateRequest`, not on `Options`. The `PARAMETER` directive in Modelfiles maps to `Options` via `api.FormatParams` in `parser/parser.go`. Since `think` is not an `Options` field, it's rejected.

**Status:** Open PR #14630 proposes adding `PARAMETER think` support. Still unmerged as of 2026-04-24.

**Workaround:** Use the native `/api/chat` endpoint with `"think": false` in the request body.

---

## Finding 2: `/v1/chat/completions` Cannot Disable Thinking

**Severity:** Critical — thinking consumes tokens and causes empty responses

**Reproduction:**

```bash
# All of these are IGNORED on the OpenAI-compat endpoint:

# Top-level think parameter
curl http://localhost:11434/v1/chat/completions \
  -d '{"model":"qwen3.6-35b-fixed","think":false,...}'

# chat_template_kwargs
curl ... -d '{"chat_template_kwargs":{"enable_thinking":false},...}'

# options.think
curl ... -d '{"options":{"think":false},...}'
```

All three produce responses with `reasoning` field containing 300-800+ tokens.

**Working alternative — native API:**
```bash
curl http://localhost:11434/api/chat \
  -d '{"model":"qwen3.6-35b-fixed","think":false,"stream":false,
       "messages":[{"role":"user","content":"Say hello"}]}'
# Result: {"content":"Hello!","thinking":"NONE","eval_count":3}
```

**Root Cause:** Ollama auto-detects Qwen3 as a thinking-capable model and sets `IsThinkSet=true, Think=true` in the template context. The `/v1/chat/completions` endpoint does not expose a way to override these. Only the native `/api/chat` endpoint accepts `"think": false` at the request level.

---

## Finding 3: Pi.dev Sends `role: "developer"` for Reasoning Models

**Severity:** Critical — causes system prompt to be silently dropped

**Reproduction:**

In `~/.pi/agent/models.json`:
```json
{"id": "qwen3.6-35b-fixed", "reasoning": true}
```

Pi.dev's `openai-completions.ts` line 683-684:
```typescript
const useDeveloperRole = model.reasoning && compat.supportsDeveloperRole;
const role = useDeveloperRole ? "developer" : "system";
```

For Ollama (not in the `isNonStandard` list), `supportsDeveloperRole` defaults to `true`. Combined with `reasoning: true`, all system messages are sent as `role: "developer"`.

Ollama does not recognize `role: "developer"` and silently drops the message. The system prompt — including tool instructions — is lost.

**Fix:**
```json
{
  "id": "qwen3.6-35b-fixed",
  "reasoning": true,
  "compat": {"supportsDeveloperRole": false}
}
```

**Verification:** Proxy logs confirmed `message_roles` array contained `"system"` (not `"developer"`) after the fix.

---

## Finding 4: Pi.dev Sends Unsupported Parameters to Ollama

**Severity:** Low-Medium — Ollama silently ignores these, but they indicate misconfiguration

**Parameters sent by Pi.dev that Ollama ignores:**

| Parameter | Value | Why It's Sent | Fix |
|-----------|-------|---------------|-----|
| `reasoning_effort` | `"medium"` | `supportsReasoningEffort` defaults to `true` | Set `false` in compat |
| `stream_options` | `{"include_usage":true}` | `supportsUsageInStreaming` defaults to `true` | Set `false` in compat |
| `strict` (in tool defs) | `false` | `supportsStrictMode` defaults to `true` | Set `false` in compat |
| `store` | `true` | `supportsStore` defaults to `true` | Set `false` in compat |

**Full compat configuration for Ollama:**
```json
"compat": {
    "supportsDeveloperRole": false,
    "supportsReasoningEffort": false,
    "supportsUsageInStreaming": false,
    "supportsStrictMode": false,
    "supportsStore": false,
    "maxTokensField": "max_tokens"
}
```

---

## Finding 5: Pi.dev Uses `max_completion_tokens` by Default

**Severity:** Medium — Ollama only understands `max_tokens`

**Root Cause:** In `detectCompat()`, `maxTokensField` defaults to `"max_completion_tokens"` unless `baseUrl.includes("chutes.ai")`:

```typescript
const useMaxTokens = baseUrl.includes("chutes.ai");
// ...
maxTokensField: useMaxTokens ? "max_tokens" : "max_completion_tokens",
```

Ollama doesn't support `max_completion_tokens` and ignores it, potentially using a default or unlimited generation.

**Fix:** `"maxTokensField": "max_tokens"` in compat.

**Verification:** Proxy logs showed `"max_tokens": 16384` (not `max_completion_tokens`) after the fix.

---

## Finding 6: Qwen CLI Example Uses `reasoning: false`

**Severity:** Informational — design guidance from Pi.dev's own examples

Pi.dev ships an example Qwen provider at:
```
~/.pi/pi-mono/packages/coding-agent/examples/extensions/custom-provider-qwen-cli/index.ts
```

The example registers Qwen3 Coder models with `reasoning: false`:
```typescript
{
    id: "qwen3-coder-plus",
    name: "Qwen3 Coder Plus",
    reasoning: false,  // <-- No thinking for coding models
    // ...
}
```

Only the vision model uses `reasoning: true` with explicit compat:
```typescript
{
    id: "vision-model",
    reasoning: true,
    compat: { supportsDeveloperRole: false, thinkingFormat: "qwen" },
}
```

**Implication:** Pi.dev's own examples avoid `reasoning: true` for coding models when using Qwen.

---

## Finding 7: `thinkingFormat` Auto-Detection Is Wrong for Ollama

**Severity:** Medium — Pi.dev doesn't know how to control Ollama's thinking

Pi.dev's `detectCompat()` defaults to `thinkingFormat: "openai"` for Ollama:

```typescript
thinkingFormat: isZai ? "zai"
    : provider === "openrouter" || baseUrl.includes("openrouter.ai") ? "openrouter"
    : "openai",
```

Available `thinkingFormat` values and what they send:
- `"openai"` → `reasoning_effort: "medium"` (Ollama ignores this)
- `"qwen"` → `enable_thinking: true/false` (Ollama ignores this on /v1)
- `"qwen-chat-template"` → `chat_template_kwargs: {enable_thinking: true/false}` (Ollama ignores this on /v1)
- `"zai"` → Z.AI specific format

**None of these work with Ollama's `/v1/chat/completions` endpoint.** Only the native `/api/chat` with `"think": false` works.

---

## Finding 8: Ollama Native API Tool Call Format

**Severity:** Informational — needed for custom provider implementation

**Non-streaming tool call response:**
```json
{
  "message": {
    "role": "assistant",
    "content": "",
    "tool_calls": [{
      "id": "call_z40g60q2",
      "function": {
        "index": 0,
        "name": "get_file",
        "arguments": {"path": "/etc/hostname"}  // Pre-parsed object, NOT JSON string
      }
    }]
  },
  "done": true,
  "done_reason": "stop",  // Always "stop", even with tool calls
  "prompt_eval_count": 153,
  "eval_count": 23
}
```

**Key differences from OpenAI format:**
1. `arguments` is a pre-parsed object, not a JSON string
2. `done_reason` is always `"stop"`, never `"tool_calls"` — must detect tool calls from `message.tool_calls` presence
3. `function` contains an `index` field
4. Usage is in `prompt_eval_count` / `eval_count` (not nested in `usage`)

**Streaming format:**
```jsonl
{"message":{"role":"assistant","content":"","tool_calls":[{"id":"call_e4hswyu1","function":{"index":0,"name":"get_file","arguments":{"path":"/etc/hostname"}}}]},"done":false}
{"message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","prompt_eval_count":153,"eval_count":23}
```

Tool calls come in the first chunk (complete, not streamed incrementally), final stats in the second chunk.

---

## Finding 9: VRAM Allocation

**Severity:** Informational — not the cause of failures

```bash
curl -s http://localhost:11434/api/ps | jq .
```

```json
{
  "size": 23736573696,      // 22.1 GiB total
  "size_vram": 21416241664, // 19.9 GiB in VRAM (90.2%)
  "context_length": 131072
}
```

Only 2.2 GiB (9.8%) is offloaded to CPU. This is a minor offload and not a significant performance bottleneck.

---

## Finding 10: Streaming Buffer Bug in Custom Extension

**Severity:** Critical — caused content to be silently dropped

In the custom Pi.dev extension for Ollama's native API, the streaming parser had a buffer handling bug:

```typescript
// BUGGY VERSION
while (true) {
    const { done, value } = await reader.read();
    if (done) break;  // Exits without processing remaining buffer!

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    // ...
}
```

When the reader signals `done`, any data remaining in `buffer` (the last JSON line without a trailing newline) is never processed. This caused:
- The final `done: true` chunk to be silently dropped
- Usage stats not being recorded
- More critically: if the model's entire content was in the last chunk, it was lost

**Fix:**
```typescript
while (true) {
    const { done, value } = await reader.read();
    if (!done) {
        buffer += decoder.decode(value, { stream: true });
    } else {
        buffer += decoder.decode();  // Flush decoder
    }

    const lines = buffer.split("\n");
    buffer = done ? "" : (lines.pop() || "");  // Process ALL lines when done

    for (const line of lines) { /* ... */ }

    if (done) break;  // Break AFTER processing
}
```

This explains the "67 output tokens but zero visible content" mystery — the content tokens were generated but the streaming parser discarded them.
