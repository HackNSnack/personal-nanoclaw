---
tags: [nanoclaw, opencode, vision, architecture]
type: reference
status: active
---

# Dual-Model Vision Routing

## Overview

Route image-bearing messages to a vision-capable model (e.g. `google/gemini-2.5-flash-lite`) while keeping text-only turns on the cheaper text model (e.g. `deepseek/deepseek-v4-flash`). Both run as separate OpenCode server processes inside the same container.

## Why

`deepseek/deepseek-v4-flash` is text-only — OpenRouter returns `No endpoints found that support image input` (404) when image parts are sent. A second model slot solves this without forcing the expensive vision model on every turn.

## Key Changes

### New env vars
```
OPENCODE_VISION_MODEL=google/gemini-2.5-flash-lite
OPENCODE_VISION_SMALL_MODEL=...   # optional, defaults to VISION_MODEL
```
If `OPENCODE_VISION_MODEL` is unset or equals `OPENCODE_MODEL`, routing is disabled and behaviour is identical to today.

### `opencode.ts` — dual runtime map
Replace the module-level singleton (`sharedRuntime`) with a keyed map:
```typescript
type RuntimeSlot = 'text' | 'vision';
const sharedRuntimes: Partial<Record<RuntimeSlot, SharedRuntime>> = {};
```
- Each slot spawns its own OpenCode server on a different port (text=`4096`, vision=`4097`)
- `buildOpenCodeConfig(options, slot)` reads the appropriate model env vars per slot
- `runtimeConfigKey` includes the slot so the two runtimes never collide

### `OpenCodeProvider` — two session IDs
```typescript
private activeSessionIds: Partial<Record<RuntimeSlot, string>> = {};
private lastSlot: RuntimeSlot | undefined;
```
`slotFor(input)` returns `'vision'` when `input.attachments` contains images AND a distinct vision model is configured; otherwise `'text'`.

Each slot resumes its own session when you return to it — e.g. text→vision→text reuses the original text session.

### Session continuity caveat
Switching slots = different OpenCode server = no shared conversation history. In practice this is fine because:
- Prior Slack messages (including the vision model's image description) are re-injected into each new prompt by the formatter
- The text model sees the *description* of the image even without seeing the image itself

Optional future improvement: inject `lastResultText` from the outgoing slot as a brief context primer when switching.

### `session_state` persistence
Currently stores one session ID. With two slots, store JSON: `{"text":"s1","vision":"s2"}`. Minor serialisation change in session state handling.

### Test hooks
`_setRuntimeForTest(rt)` defaults to setting the `'text'` slot — existing tests stay green with no changes.

## First-Cut Scope (ship fast)
- Dual runtimes + dual in-memory session IDs ✅
- Port parameterisation ✅
- No context bridging (rely on Slack history re-injection) ✅
- No persistent dual-session-state (both sessions start fresh on container restart) ✅

Bridging and persistent dual-session-state are follow-up improvements.

## Related

- [[opencode.ts]] — provider implementation
- [[image-attachments.test.ts]] — three-layer pipeline tests
- Debugged 2026-06-30: `deepseek/deepseek-v4-flash` confirmed text-only via direct OpenRouter API call
