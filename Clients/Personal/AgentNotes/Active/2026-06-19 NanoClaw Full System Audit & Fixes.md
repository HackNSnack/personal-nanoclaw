---
tags: [nanoclaw, debugging, deepseek, opencode, openrouter, audit, slack]
type: work
status: done
---

# NanoClaw Full System Audit & Fixes

**Date:** 2026-06-19  
**Triggered by:** User reported truncated Slack responses — messages stopping mid-sentence, and specifically: `<message to="slack">Good catch — that's a formatting glitch. When I make tool calls (which use \`` — the message simply stopped.

**Outcome:** 3 fixes shipped, service rebuilt and running. Two follow-up items documented below.

---

## Research Methodology

The investigation was driven by pi (the development agent) using the following sources in parallel:

### 1. Git history

```bash
git log --oneline -30
git show <sha> --stat   # for each personal commit
git diff 28e3252..HEAD -- src/ container/
```

Identified 4 personal commits on top of upstream:
- `f6b3259` — Added retry logic (`opencode.ts`)
- `da4e601` — Fixed dropped messages (unclosed-tag fallback + error notice)
- `f032cda` — Timestamps in logs + Slack socket ping timeout fix
- `339c164` — Merged upstream into fork

### 2. Full source read

Key files read in full:
- `src/channels/slack.ts` — Slack socket mode setup + ping timeout interception
- `src/router.ts` — Inbound routing, session resolution, fan-out logic
- `container/agent-runner/src/providers/opencode.ts` — OpenCode SSE loop, session lifecycle
- `container/agent-runner/src/poll-loop.ts` — Message dispatch, `dispatchResultText`, wrapping-retry nudge
- `container/agent-runner/src/formatter.ts` — XML prompt formatting
- `container/skills/slack-formatting/SKILL.md` — Slack mrkdwn reference
- `container/skills/whatsapp-formatting/instructions.md` — Auto-loaded WhatsApp fragment
- `src/claude-md-compose.ts` — How CLAUDE.md and `.claude-fragments/` are generated at spawn

### 3. Obsidian notes

Read all existing NanoClaw reference notes:
- `NanoClaw Operations.md` — Runbook, env vars, common fixes
- `NanoClaw NixOS Setup.md` — Full deployment map
- `2026-06-11 NanoClaw OpenCode Provider Setup.md` — Earlier debug session
- `DeepSeek Missing Closing Tag — Silent Response Drop.md` — Previous bug investigation
- `MEMORY.md` — Current authoritative agent memory (authoritative vs. what's on disk)
- `skills.md` — Skill catalog

### 4. Web research

Searched for:
- DeepSeek V4 Flash architecture (284B total / 13B active MoE, 1M context, MIT)
- DeepSeek special tokens and chat template format (`<｜begin▁of▁sentence｜>`, `<｜end▁of▁sentence｜>`, `<｜User｜>`, `<｜Assistant｜>`)
- DeepSeek stop sequence / SSE behaviour

Key finding: DeepSeek V4 Flash does not use a standard Jinja chat template — it has its own encoding format documented in `deepseek-ai/DeepSeek-V4-Flash` on Hugging Face. Via OpenRouter/OpenAI-compatible API this is abstracted, but the model's training for structured output is less rigorous than frontier models.

---

## System Architecture (Current State)

```
Slack (Socket Mode)
  ↓ @mention
NanoClaw host  (Node.js, systemd user service nanoclaw-v2-a72e394a)
  src/channels/slack.ts   — Socket Mode, custom ping timeout interception
  src/router.ts           — Inbound routing, session resolution, fan-out
  src/container-runner.ts — Docker spawn + OneCLI credential injection
  ↓
SQLite inbound.db  (per session, in data/v2-sessions/...)
  ↓ wakeContainer()
Docker container  (nanoclaw-agent-v2-a72e394a:latest)
  container/agent-runner/src/index.ts         — Entrypoint
  container/agent-runner/src/poll-loop.ts     — Message dispatch loop
  container/agent-runner/src/providers/opencode.ts — OpenCode subprocess + SSE
  ↓ spawn opencode serve --port 4096
OpenCode server (HTTP, SSE stream)
  ↓ HTTPS_PROXY → OneCLI (port 10255)
OpenRouter → DeepSeek V4 Flash
  ↓ resultText
poll-loop dispatchResultText()  — parses <message to="name">...</message>
  ↓
SQLite messages_out  →  NanoClaw host delivery  →  Slack
```

**Provider config (`.env`):**
```
OPENCODE_PROVIDER=openrouter
OPENCODE_MODEL=deepseek/deepseek-v4-flash
OPENCODE_SMALL_MODEL=deepseek/deepseek-v4-flash
ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1
```

**Agent context loaded at container spawn:**
1. `/app/CLAUDE.md` — global `container/CLAUDE.md` (generic base)
2. `/workspace/agent/.claude-fragments/*.md` — auto-generated fragments (modules + skill instructions)
3. `/workspace/agent/CLAUDE.local.md` — per-group memory (`groups/cli-with-mathipe/CLAUDE.local.md`)

---

## Findings

### What is Working

| Component | Status | Notes |
|-----------|--------|-------|
| Slack Socket Mode connection | ✅ | Custom ping timeout interception in `slack.ts` prevents false disconnects |
| Message routing host → container | ✅ | |
| OpenCode + OpenRouter integration | ✅ | |
| `send_message()` MCP mid-turn | ✅ | No SSE race — different delivery path |
| Fix 1: unclosed `</message>` fallback | ✅ | Added 2026-06-18 in `da4e601` |
| Fix 2: user-visible error notice on retry exhaustion | ✅ | Added 2026-06-18 in `da4e601` |
| Retry logic for transient errors (5xx, timeout) | ✅ | Added 2026-06-18 in `f6b3259` |
| Stale session auto-recovery | ✅ | `STALE_SESSION_RE` in `opencode.ts` |
| Timestamps in all container logs | ✅ | Added 2026-06-15 in `f032cda` |

### What Was Broken / Root Causes

#### 🔴 1. SSE race condition — truncated responses (root cause of the reported symptom)

**Symptom:** Messages arrive in Slack but stop mid-sentence.  
**Example:** `<message to="slack">Good catch — that's a formatting glitch. When I make tool calls (which use \``  

**Root cause:**  
In `providers/opencode.ts`, the `gen()` generator builds `resultText` by accumulating `message.part.updated` SSE events. When `session.idle` fires, the code immediately breaks the turn loop and assembles `resultText` from whatever is in `partTextByMessageId`. For DeepSeek V4 Flash on long responses, the final SSE tokens arrive **after** `session.idle` due to an ordering race in the OpenCode SSE pipeline — the `partTextByMessageId` snapshot is therefore incomplete.  

Fix 1 (added 2026-06-18) delivered the truncated content rather than silently dropping it, which is why responses *appear* in Slack but are cut short. That was symptom mitigation, not root-cause resolution.

**Fix applied (2026-06-19):** 400ms drain window after `session.idle` — see below.

#### 🔴 2. CLAUDE.local.md diverged from authoritative MEMORY.md

**Symptom:** Agent has incomplete/wrong instructions — missing identity ("Claudette" name), missing Platform Notes explaining *why* tool calls must precede text, missing People section, missing two repos.

**Root cause:** Earlier weak-LLM-assisted edits to `CLAUDE.local.md` diverged from the Obsidian MEMORY.md which is the authoritative source.

Missing sections:
- Identity block (name, platform, runtime)
- Platform Notes (DeepSeek V4 Flash `session.idle` after text output — the *reason* for the tool-call-first rule)
- People (Mathias/Beate with Slack handles, inline)
- DO section
- Full repos table (only PiConfig was listed; Obsidian-Netlight and nanoclaw-fork were missing)

**Fix applied (2026-06-19):** CLAUDE.local.md rewritten as a clean merge of both files.

#### 🟠 3. Slack formatting skill not auto-loaded

**Root cause:** `composeGroupClaudeMd()` in `src/claude-md-compose.ts` auto-includes any container skill that has an `instructions.md` file. The WhatsApp formatting skill had one (`container/skills/whatsapp-formatting/instructions.md`) and was therefore auto-loaded into every agent's `.claude-fragments/`. The Slack formatting skill existed only as `SKILL.md` (user-invocable) — no `instructions.md` — so it was never auto-loaded.

Result: agents received WhatsApp phone-mention rules automatically, but Slack mrkdwn rules only if CLAUDE.local.md happened to include them.

**Fix applied (2026-06-19):** Created `container/skills/slack-formatting/instructions.md`. Will appear in fragments on next container spawn.

#### 🟡 4. Missing `files:read` Slack OAuth scope (not yet fixed)

**Symptom:** Every message with a file or image attachment fails silently:  
```
Failed to download file from Slack: received HTML login page instead of file data.
```
**Fix:** Add `files:read` to Bot Token Scopes in the Slack app config at api.slack.com → OAuth & Permissions, then reinstall the app. ~5 minutes.

#### 🟡 5. Recurring Slack WebSocket pong timeouts (not yet fixed)

`socket-mode:SlackWebSocket:N A pong wasn't received from the server before the timeout of 15000ms` appears repeatedly in logs. SDK reconnects automatically. Not confirmed to cause delivery failures, but worth watching.

---

## Fixes Applied

### Fix A — SSE drain window after `session.idle`

**File:** `container/agent-runner/src/providers/opencode.ts`  
**Commit:** `7278c1e` — "Fix SSE race + add Slack formatting skill fragment"  

Added a `IDLE_DRAIN_WINDOW_MS` constant (default 400ms, env-configurable via `OPENCODE_IDLE_DRAIN_WINDOW_MS`) and a drain loop inside the `session.idle` handler:

```typescript
const IDLE_DRAIN_WINDOW_MS = Number(process.env.OPENCODE_IDLE_DRAIN_WINDOW_MS) || 400;

// In the session.idle case:
if (sid === sessionId) {
  const drainDeadline = Date.now() + IDLE_DRAIN_WINDOW_MS;
  while (true) {
    const remaining = drainDeadline - Date.now();
    if (remaining <= 0) break;
    const outcome = await Promise.race([
      stream.next().then((r) => ({ timedOut: false, value: r.value ?? undefined, done: r.done ?? false })),
      new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), remaining)),
    ]);
    if (outcome.timedOut || outcome.done) break;
    if (outcome.value?.type === 'message.part.updated') {
      // capture any trailing tokens
      partTextByMessageId.set(part.messageID, part.text);
    } else if (outcome.value?.type === 'session.idle' && innerSid === sessionId) {
      break; // second idle = genuinely done
    }
  }
  break turn; // then assemble resultText as before
}
```

The drain window gives trailing SSE tokens up to 400ms to arrive before `resultText` is assembled. If the timeout fires first, a pending `stream.next()` remains in-flight — it will consume the next SSE event (typically a heartbeat) without anyone observing the result. For a single-session agent this is acceptable.

**Tests:** All 28 existing OpenCode retry tests pass. The 2 pre-existing integration test failures are unrelated (thread routing tests, pre-existing before this change).

### Fix B — CLAUDE.local.md synced with MEMORY.md

**File:** `groups/cli-with-mathipe/CLAUDE.local.md` (gitignored — per-installation state)  

Added missing sections:
- Identity block: name Claudette, platform, runtime
- Platform Notes: explains DeepSeek `session.idle` after text output, and *why* tool calls must come first
- People: Mathias and Beate with Slack handles, inline
- DO section: explicit formatting and delivery rules
- Full repos table: all three repos (Obsidian-Netlight, nanoclaw-fork, PiConfig)

This note (`MEMORY.md`) has been updated to match.

### Fix C — Slack formatting `instructions.md` created

**File:** `container/skills/slack-formatting/instructions.md`  
**Commit:** `7278c1e` (same commit as Fix A)  

Created concise mrkdwn reference (bold, italic, code, links, mentions, emoji, blockquotes, bullets) and explicit "never use" list (no `##` headings, no `**double asterisks**`, no `[text](url)`, no tables, no `---`). Auto-loads into `.claude-fragments/skill-slack-formatting.md` on next container spawn.

---

## Deployment

```bash
# Container rebuilt with new opencode.ts
cd container && docker build -t nanoclaw-agent-v2-a72e394a:latest .

# Service restarted
systemctl --user restart nanoclaw-v2-a72e394a

# Verified clean start:
# [chat-sdk:slack] Slack socket mode connected
# [INFO] NanoClaw running
```

All three changes are live. The slack-formatting fragment will activate on the first message (next container spawn).

---

## Remaining Work

| Item | Effort | Priority |
|------|--------|----------|
| Add `files:read` OAuth scope to Slack app | ~5 min at api.slack.com | 🟡 Low |
| Monitor WebSocket pong timeouts for delivery failures | Ongoing | 🟡 Low |
| Consider model upgrade to DeepSeek V4 Pro for better XML adherence | Research | 🟠 Medium |

---

## Related

- [[Clients/Personal/AgentNotes/Reference/NanoClaw/DeepSeek Missing Closing Tag — Silent Response Drop]] — earlier investigation; SSE race now fixed
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/NanoClaw Operations]] — runbook (updated with `OPENCODE_IDLE_DRAIN_WINDOW_MS`)
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/MEMORY.md]] — agent memory (updated to match new CLAUDE.local.md)
- [[Clients/Personal/AgentNotes/Active/2026-06-11 NanoClaw OpenCode Provider Setup]] — earlier session: OpenCode provider setup, model ID format bugs
