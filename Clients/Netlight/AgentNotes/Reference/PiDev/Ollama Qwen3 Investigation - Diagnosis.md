# Ollama Qwen3.6-35B Investigation - Diagnosis Journey

**Date:** 2026-04-24
**Model:** `batiai/qwen3.6-35b:q4` on Ollama, served via `/v1/chat/completions`
**Client:** Pi.dev coding agent
**GPU:** Single NVIDIA GPU, 19.9 GiB VRAM used / 22.1 GiB total model size (90.2% VRAM, 2.2 GiB CPU offload)

---

## Problem Statement

The Qwen3.6-35B model running locally on Ollama would "randomly stop" when used through Pi.dev. The model would generate very short responses (1-3 seconds, ~10-30 tokens) and terminate with HTTP 200 OK and `finish_reason: "stop"`. No errors were reported by Ollama. The model was expected to make tool calls and continue multi-turn conversations but instead output brief text or empty content and stopped.

---

## Phase 1: Initial Server Log Analysis

### What We Observed

Ollama server logs showed normal-looking completions:

```
[GIN] 2026/04/24 - 14:49:47 | 200 | 3.900438468s | 127.0.0.1 | POST "/v1/chat/completions"
msg="context for request finished" runner.vram="18.6 GiB" runner.num_ctx=131072
msg="runner with non-zero duration has gone idle, adding timer" duration=5m0s
```

Key fields in cache logs:

```
msg="loading cache slot" cache=11060 prompt=4539 used=2560 remaining=1979
```

### Initial (Incorrect) Hypothesis

We initially suspected `remaining=1979` was a generation cap. This was **wrong**. The `remaining` field represents new prompt tokens not yet in the KV cache (`prompt - used = remaining`). It has nothing to do with output token limits.

### What the Logs Actually Showed

- All requests returned HTTP 200 — no errors
- Response times of 1-3 seconds = very few output tokens (~10-30 at the model's generation speed)
- The model was completing its turn normally from Ollama's perspective
- `refCount=0` after each request = runner going idle (normal)

---

## Phase 2: Modelfile Analysis

### Original Modelfile

The original model (`batiai/qwen3.6-35b:q4`) had this configuration:

```
PARAMETER num_ctx 131072
PARAMETER stop <|im_end|>
PARAMETER stop <|endoftext|>
PARAMETER stop <|im_start|>    # <-- PROBLEMATIC
PARAMETER temperature 0.7
PARAMETER top_k 20
PARAMETER top_p 0.95
```

### Issue: `<|im_start|>` as a Stop Token

The `<|im_start|>` stop token could cause premature termination if the model generated this token during thinking or tool call formatting. However, removing it did not fix the core issue.

### Issue: No `num_predict` Set

Without explicit `num_predict`, the model might use a default generation limit. We added `num_predict -1` (unlimited). This also did not fix the core issue.

### Issue: `PARAMETER think false` Not Supported

We attempted to add `PARAMETER think false` to the Modelfile. Ollama rejected this with:

```
Error: unknown parameter 'think'
```

**Root cause:** The `think` field exists on `ChatRequest` and `GenerateRequest` in Ollama's API, but NOT on the `Options` struct that `PARAMETER` maps to. This is a known gap — PR #14630 on GitHub proposes adding it but was still unmerged as of 2026-04-24.

### Issue: `SYSTEM /no_think` Backfired

We tried putting `/no_think` in the `SYSTEM` directive. The model saw this as literal text in its system prompt and got confused. Its reasoning output showed:

> "The user prompt contains `/think` at the end..."

The model interpreted `/no_think` as a confusing instruction rather than a thinking-mode toggle. The thinking toggle must be in the **user message**, not the system prompt, per the Qwen3 template specification.

### Attempted Template Overrides

We tried overriding the `TEMPLATE` to:
1. Append `/no_think` to every user message
2. Pre-fill `<think>\n\n</think>\n\n` in the assistant prefix

**Results:**
- Simple curl tests worked — tool calls generated correctly with `finish_reason: "tool_calls"`
- Multi-turn conversations in Pi.dev failed — the model would generate empty content after receiving tool results
- Appending `/no_think` to ALL user messages was wrong — the original template only appends it to the LAST user message

We ultimately reverted all template changes and kept the base model template.

---

## Phase 3: Pi.dev ↔ Ollama Compatibility

### Discovery: `supportsDeveloperRole` Bug

**This was the first real breakthrough.**

Pi.dev's `openai-completions.ts` provider auto-detects compatibility settings based on the API endpoint URL. For Ollama (localhost:11434), it detects as a standard OpenAI endpoint:

```typescript
// In openai-completions.ts, detectCompat()
const isNonStandard = provider === "cerebras" || ... || isZai || ...;
// Ollama is NOT in this list

return {
    supportsDeveloperRole: !isNonStandard,  // TRUE for Ollama
    // ...
};
```

Then, for reasoning models:

```typescript
const useDeveloperRole = model.reasoning && compat.supportsDeveloperRole;
const role = useDeveloperRole ? "developer" : "system";
```

Since the model was configured with `"reasoning": true` in `models.json`, Pi.dev sent system messages as `role: "developer"`. **Ollama does not understand the `developer` role**, so the entire system prompt — including tool definitions — was silently dropped.

**Fix:** Added `"compat": {"supportsDeveloperRole": false}` to the model config in `~/.pi/agent/models.json`.

### Verification via Curl

After the compat fix, direct curl tests confirmed tool calling worked:

```bash
curl -s http://localhost:11434/v1/chat/completions \
  -d '{"model":"qwen3.6-35b-fixed","stream":false,
       "tools":[...],
       "messages":[{"role":"user","content":"Read /etc/hostname"}]}' | jq .
```

Response:

```json
{
  "choices": [{
    "message": {
      "tool_calls": [{
        "id": "call_uv52vha9",
        "function": {"name": "get_file", "arguments": "{\"path\":\"/etc/hostname\"}"}
      }]
    },
    "finish_reason": "tool_calls"
  }]
}
```

Both streaming and non-streaming formats returned correct tool calls.

---

## Phase 4: Proxy-Based Traffic Analysis

### Setup

We created a Python reverse proxy on port 8877 that logged all request/response metadata between Pi.dev and Ollama:

```python
# ~/.ollama_local_models/proxy.py
# Logged: model, stream, tools_count, message_roles, max_tokens,
#         reasoning_effort, enable_thinking, stream_options, etc.
```

Temporarily changed `models.json` baseUrl to `http://127.0.0.1:8877/v1`.

### Key Findings from Proxy Logs

Every request from Pi.dev showed:

```json
{
  "max_tokens": 16384,
  "reasoning_effort": "medium",
  "stream_options": {"include_usage": true},
  "message_roles": ["system", "user", "assistant", "tool", ...]
}
```

**Issues identified:**

| Parameter | Value Sent | Problem |
|-----------|-----------|---------|
| `reasoning_effort` | `"medium"` | Ollama ignores this; should not be sent |
| `stream_options` | `{"include_usage": true}` | Ollama may not support this |
| `max_tokens` | `16384` | Correct (our `maxTokensField` fix worked) |
| `message_roles` | Contains `"system"` | Correct (our `supportsDeveloperRole` fix worked) |

**Critical positive finding:** The model successfully ran up to **37 messages** with multiple consecutive tool calls in one session. The failures were now **intermittent**, not systematic.

### Additional Compat Fixes Applied

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

## Phase 5: Thinking Mode Investigation

### The Core Problem with `/v1/chat/completions`

We discovered that Ollama's OpenAI-compatible endpoint (`/v1/chat/completions`) **auto-enables thinking** for Qwen3 models and provides **no way to disable it from the client side**.

**Test 1 — No thinking control:**
```bash
curl -s http://localhost:11434/v1/chat/completions \
  -d '{"model":"qwen3.6-35b-fixed","stream":false,
       "messages":[{"role":"user","content":"Say hello"}]}' | jq .
```
Result: `reasoning` field present with ~400 tokens of thinking, `content` only ~10 tokens.

**Test 2 — `chat_template_kwargs` (ignored):**
```bash
curl ... -d '{"chat_template_kwargs":{"enable_thinking":false},...}'
```
Result: Thinking still present. Parameter ignored.

**Test 3 — `think: false` top-level (ignored):**
```bash
curl ... -d '{"think":false,...}'
```
Result: Thinking still present. Parameter ignored on the OpenAI-compat endpoint.

**Test 4 — Native `/api/chat` with `think: false` (WORKS):**
```bash
curl -s http://localhost:11434/api/chat \
  -d '{"model":"qwen3.6-35b-fixed","stream":false,"think":false,
       "messages":[{"role":"user","content":"Say hello"}]}'
```
Result:
```json
{"content": "Hello!", "thinking": "NONE", "eval_count": 3}
```

**3 tokens, zero thinking.** The native API properly supports `think: false`.

### Implications

On the OpenAI-compat endpoint, every response from the model included 300-800+ tokens of thinking overhead. In complex multi-turn scenarios, the model would occasionally "think itself into a corner" and generate empty content — producing 67 output tokens (consumed by thinking) but zero visible text.

---

## Phase 6: Session Log Analysis

### Session Log Location

Pi.dev session logs are at `~/.pi/agent/sessions/<session-dir>/<timestamp>.jsonl`. Each line is a JSON object with message role, content, usage, provider, model, and stopReason.

### Observed Failure Pattern

A typical failing session showed:

```
[user]      → "Load context from Obsidian"
[assistant] → toolCall: mcp (list_files_in_dir) → stopReason=toolUse ✓
[toolResult] → Error: wrong parameter name (directory_path vs dirpath)
[assistant] → toolCall: mcp (corrected params) → stopReason=toolUse ✓
[toolResult] → File listing + file contents (success)
[assistant] → stopReason=stop, content=[], usage.output=67 ← FAILURE
```

The model generated 67 output tokens but produced zero visible content. The tokens were consumed by thinking (on the OpenAI-compat endpoint) or lost to a streaming buffer bug (on the native API).

### Model Quality Issues Also Observed

Even when tool calling worked, the model showed quality issues:
- Used `directory_path` instead of `dirpath` (wrong parameter names)
- Used agent name `"default"` when only `planner`, `reviewer`, `scout`, `worker` existed
- Hallucinated nonexistent tool names

These are Q4 quantization quality issues, separate from the configuration problems.
