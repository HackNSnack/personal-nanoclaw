---
tags:
  - nanoclaw
  - opencode
  - debugging
  - deepseek
  - openrouter
  - poll-loop
type: reference
status: active
---

# DeepSeek Missing `</message>` Tag — Silent Response Drop

**Symptom:** Agent produces a response (visible in OpenRouter trace), but nothing arrives in Slack. No error message is shown. The container runs until it hits the 30-minute absolute ceiling, then is killed.

**First documented:** 2026-06-18  
**Affects:** NanoClaw installs using the `opencode` provider with DeepSeek V4 Flash (or other non-Anthropic models prone to omitting XML closing tags on long responses).

---

## Quick Fix (if it happens again)

This is now **handled automatically** by the fallback in `poll-loop.ts` (see code changes below). If a response is dropped despite the fix, check:

```bash
# Check the container logs for the specific session
docker logs <container-name> 2>&1 | grep -E "WARNING|scratchpad|Result:" | tail -20

# If you see the old "no <message to=\"...\"> blocks" warning without the new
# "missing closing tag — delivering anyway" line, the container image is stale.
# Rebuild and restart:
./container/build.sh
systemctl --user restart nanoclaw-v2-<id>.service
```

If the user reports getting no reply **and no error notice**, the fix is not live in the running container.

---

## Investigation Log

### Starting point

User reported that a message sent via Slack — asking the agent to prepare a Trumf/EuroBonus points calculation document — never received a reply. However, the agent's response *was* visible in the OpenRouter activity trace, proving the model had generated a complete response.

### Step 1 — Rule out the obvious (duplicate services, adapter down)

First check was the debug skill's most common cause: duplicate NanoClaw instances racing on delivery. Checked:

```bash
ps aux | grep 'nanoclaw/dist/index.js' | grep -v grep
# → only one process (PID 9192)

grep "Channel adapter started" logs/nanoclaw.log | tail -5
# → slack adapter started cleanly, single instance
```

No duplicate. No `platformMsgId=undefined` entries in the log (which would indicate the WhatsApp-era null-adapter race condition). Ruled out.

### Step 2 — Check for crash / service instability

The error log (`logs/nanoclaw.error.log`) showed two unrelated issues:

- **Historical crash loop (earlier that day, ~13:53 UTC):** `better_sqlite3` NODE_MODULE_VERSION mismatch (compiled for v137, running v127). The circuit breaker triggered 5 restart attempts with exponential backoff before it was resolved. This was a separate incident and was already resolved before the user's message arrived.
- **Recurring Slack WebSocket pong timeouts:** `socket-mode:SlackWebSocket:N A pong wasn't received from the server before the timeout of 15000ms` — these appeared repeatedly throughout the day. Concerning but not fatal; Socket Mode reconnects automatically.
- **Attachment download failures:** Multiple `Failed to download file from Slack: received HTML login page` errors — missing `files:read` OAuth scope. Separate issue, not related to this bug.

None of these explained the silent drop.

### Step 3 — Trace the specific message through the host logs

Searched `logs/nanoclaw.log` for the current session:

```
[12:19:08] Session created    sess-1781777948188-1cnifn
[12:19:08] Message routed     → container spawned
[12:19:30] Message delivered  platformMsgId=1781777969.868069  ✅ (first response)
[12:19:41] Message delivered  platformMsgId=1781777981.353869  ✅ (second response)
[12:27:23] Message routed     (follow-up question about eurobonus.shopping)
[12:28:12] Message delivered  platformMsgId=1781778492.102879  ✅
[12:40:25] Message routed     (THE failing message — Trumf/EB calculation request)
             ... nothing after this ...
[13:11:09] Killing container  reason=absolute-ceiling  ← 52 min later
```

The host correctly received and routed the 12:40 message. It just never logged a delivery for it. The container was killed 31 minutes later.

At this point, the failure was clearly *inside* the container — the host had done its job.

### Step 4 — Inspect the outbound database

Queried the session's `outbound.db`:

```bash
pnpm exec tsx scripts/q.ts \
  "data/v2-sessions/ag-1781098614662-lx2src/sess-1781777948188-1cnifn/outbound.db" \
  "SELECT * FROM messages_out ORDER BY seq DESC LIMIT 5;"
```

Result: only 3 rows, all from *before* 12:40. The 12:40 message produced zero rows in `messages_out`. The agent had not written anything to the outbound DB.

### Step 5 — Read the container logs directly

This was the breakthrough:

```bash
docker logs nanoclaw-v2-cli-with-mathipe-1781777948416 2>&1 | tail -30
```

Output:
```
[10:40:25.899Z][poll-loop] Pushing 1 follow-up message(s) into active query
[10:40:35.238Z][poll-loop] Result: 

<message to="slack">Here's my understanding of what you want me to do:
**Task:** Create a document ...
[10:40:35.271Z][poll-loop] [scratchpad] <message to="slack">Here's my understanding...
[10:40:35.271Z][poll-loop] WARNING: agent output had no <message to="..."> blocks — nothing was sent
[10:40:43.832Z][poll-loop] Result: 

<message to="slack">Here's my understanding of what you want:
[10:40:43.865Z][poll-loop] [scratchpad] <message to="slack">Here's my understanding...
[10:40:43.865Z][poll-loop] WARNING: agent output had no <message to="..."> blocks — nothing was sent
```

The agent's output *clearly starts* with `<message to="slack">`. Yet the poll-loop says no blocks were found and logs the entire response as scratchpad. This is paradoxical.

### Step 6 — Understanding the paradox

Looked at `dispatchResultText` in `poll-loop.ts`:

```typescript
const MESSAGE_RE = /<message\s+to="([^"]+)"\s*>([\s\S]*?)<\/message>/g;
```

This regex requires **both** an opening `<message to="...">` AND a closing `</message>`. Non-greedy `[\s\S]*?` still needs the closing tag to terminate.

Verified with a quick test:
```js
// Complete tag → matches
/<message\s+to="([^"]+)"\s*>([\s\S]*?)<\/message>/g.exec('<message to="slack">Hello</message>')
// → match

// Missing closing tag → no match
/<message\s+to="([^"]+)"\s*>([\s\S]*?)<\/message>/g.exec('<message to="slack">Hello world')
// → null
```

The scratchpad log shows the ENTIRE response starting at `<message to="slack">` — meaning the regex found no complete block at all, so `lastIndex` stayed at 0, and everything was accumulated as scratchpad. The `</message>` tag was simply not in `event.text`.

### Step 7 — Confirm via OpenRouter trace

The user's pasted OpenRouter trace (with pi-lens DSML encoding) decoded to:
```
<message to="slack">Here's my understanding of what you want:
...
Is that right? Give me your shop list and I'll get started.
</message>
```

So the *model* did generate `</message>`. But the agent-runner never received it. The conclusion: **`session.idle` fired from OpenCode's SSE stream before the final `message.part.updated` event that would have included the closing tag**. The `partTextByMessageId` map captured an incomplete snapshot, missing the last few tokens.

### Step 8 — Trace the retry/nudge behaviour

From the poll-loop code, after a failed dispatch:

1. `hasUnwrapped = true`, `unwrappedNudged = false` → `willRetryWrapping = true`
2. System pushes `<system>Your response was not delivered...</system>` nudge
3. Sets `unwrappedNudged = true`
4. Model retries at 10:40:43 — same failure (same truncation from the same SSE race)
5. Now `unwrappedNudged = true` → `willRetryWrapping = false`
6. `archivePrompts.shift()` runs, loop idles, **nothing delivered, no error shown**
7. Container sits waiting for new inbound messages until killed at 13:11 (52 min later)

This confirmed there was no user-visible failure signal at all — the message was silently eaten.

---

## Root Cause

Two compounding issues:

**1. OpenCode SSE race condition with long responses**

The OpenCode provider (`providers/opencode.ts`) builds `resultText` from `message.part.updated` SSE events that stream progressive text snapshots. When `session.idle` fires, the agent-runner breaks out of the turn loop and assembles `resultText` from whatever is currently in `partTextByMessageId`. For long responses, the final SSE chunk (containing the `</message>` closing tag) can arrive *after* `session.idle`, meaning it is never processed. Short responses (≤ ~200 tokens) consistently avoid this because all chunks arrive well before idle.

**2. `dispatchResultText` requires a complete `</message>` tag**

The regex has no fallback for unclosed tags. If `</message>` is absent, the entire response is discarded as scratchpad, a wrapping-nudge is sent, and if the retry also fails, the message is silently dropped with no user notification.

---

## Code Changes Applied (2026-06-18)

All changes in `container/agent-runner/src/poll-loop.ts`. **Container rebuild required** (source is live-mounted but the agent-runner is compiled via bun at build time for this provider).

### Fix 1 — Fallback for unclosed `<message>` tags

Added after the main `MESSAGE_RE` loop in `dispatchResultText`. If no complete blocks matched but the full text (stripped of internal tags) starts with an opening `<message to="...">`, treat everything after it as the message body:

```typescript
if (sent === 0 && scratchpad) {
  const UNCLOSED_RE = /^<message\s+to="([^"]+)"\s*>([\s\S]*)$/;
  const uc = stripInternalTags(text.trim()).match(UNCLOSED_RE);
  if (uc) {
    const dest = findByName(uc[1]);
    if (dest) {
      const body = uc[2].trim();
      log(`WARNING: <message to="${uc[1]}"> was missing closing tag — delivering anyway`);
      sendToDestination(dest, body, routing);
      sent++;
    }
  }
}
```

Log signature when triggered: `WARNING: <message to="slack"> was missing closing tag — delivering anyway`

### Fix 2 — User-visible error notice after retry exhaustion

Added after `if (!willRetryWrapping) archivePrompts.shift()`. When both attempts have failed, instead of silently dropping:

```typescript
if (hasUnwrapped && !willRetryWrapping) {
  deliverErrorResult(
    '_My response couldn\'t be delivered due to a formatting error. Please resend your message._',
    routing,
  );
}
```

### Test update

`integration.test.ts`: the `bare text produces no outbound messages (scratchpad only)` test was renamed and updated to assert that **1** outbound message is written (the error notice) and that its body contains `"formatting error"`.

---

## Future Impacts & Things to Watch Out For

### ⚠️ The underlying SSE race is not fixed

Fix 1 is a recovery mechanism, not a root-cause fix. The `session.idle` / `message.part.updated` ordering issue in the OpenCode provider still exists. If DeepSeek starts producing responses where the *body itself* (not just the closing tag) is truncated, Fix 1 will deliver a partial response rather than nothing. This is still better than silence, but worth knowing.

A proper fix would be to wait a short grace period after `session.idle` to drain any remaining `message.part.updated` events before assembling `resultText`. This has not been implemented.

### ⚠️ Fix 1 only handles the simple case

The fallback regex `^<message\s+to="...">` anchors to the *start* of the stripped text. This handles the common pattern where the entire response is one unclosed block. It will **not** handle:
- Multiple blocks where the last one is unclosed (middle blocks would still be dispatched correctly by the main regex; only the tail block is lost)
- A leading `<internal>` block followed by an unclosed `<message>` (the `stripInternalTags` call removes it first, so this should be fine)
- A case where the truncation removes content mid-word inside the body (the partial text will be delivered as-is)

### ⚠️ Model-specific: Claude would not trigger this

Claude (claude-sonnet, claude-opus etc.) reliably closes XML tags even in long responses. This issue is specific to cheaper/faster models like DeepSeek V4 Flash that are less rigorous about structured output adherence. If the model is ever switched back to Claude, this code path will never fire. If a new cheap model is trialled, test it with a long-response prompt before relying on it.

### ⚠️ The `files:read` OAuth scope is missing

A separate issue surfaced during this investigation: the Slack app is missing the `files:read` scope. Every message with an image or file attachment fails silently with:
```
Failed to download file from Slack: received HTML login page instead of file data.
```
This needs to be added in the Slack app configuration at api.slack.com → OAuth & Permissions → Scopes → Bot Token Scopes. Without it, any attachment sent to the bot is silently dropped.

### ⚠️ Slack WebSocket pong timeouts are recurring

`socket-mode:SlackWebSocket:N A pong wasn't received from the server before the timeout of 15000ms` appeared repeatedly across sessions. The SDK reconnects automatically but if these timeouts happen *during* a message delivery attempt, the Slack API call (`chat.postMessage`) could fail and leave the message undelivered. This has not been observed causing a confirmed failure, but it is worth watching — if "delivered but not visible" reports come in, this is a candidate cause.

### ⚠️ Absolute ceiling kills long-running sessions mid-work

Several containers were killed at the 30-minute ceiling during this session, including one that had been waiting 52 minutes (ceiling was not enforced promptly). If the agent is asked to do something genuinely long-running (e.g. browse 18 pages of a website, write a large document), it will be killed before finishing. The ceiling is a safety net, not a design limit — but users should be aware that very long tasks may time out silently.

---

## Related

- [[Clients/Personal/AgentNotes/Reference/NanoClaw/OpenCode + OpenRouter Configuration]] — full architecture, OneCLI auth, model format  
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/OpenCode ProviderModelNotFoundError — Stale Session Loop]] — related OpenCode provider debugging  
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/NanoClaw Operations]] — start/stop, logs, common fixes  
- [[Clients/Personal/AgentNotes/Reference/SAS Travels/SAS EuroBonus & SkyTeam Analysis]] — the conversation that triggered this bug
