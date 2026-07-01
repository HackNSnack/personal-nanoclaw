---
tags: [nanoclaw, opencode, mistral, mcp, poll-loop, tokens, investigation]
type: work
status: in-progress
date: 2026-07-01
---

# 2026-07-01 OpenCode send_message Double-Completion Investigation

**Status: fix implemented and unit-tested; live-tested once against real Mistral traffic, one gap found and patched (see Update below). Not yet re-tested live after the second patch.**

Context: [[Clients/Personal/AgentNotes/Reference/NanoClaw/OpenCode + OpenRouter Configuration]], [[Clients/Personal/AgentNotes/Reference/NanoClaw/NanoClaw Operations]]

## Symptom

With the opencode provider (Mistral via OpenRouter), a turn that correctly delivers via the send_message MCP tool keeps going: the model gets nudged with Nothing was delivered even though it did deliver, and burns extra completions repeating/re-explaining itself.

Observed live in a Slack test. Sequence of events in the OpenCode session transcript for one turn:

1. User message arrives (hello).
2. Assistant message with empty text content and one tool call: nanoclaw_send_message with arguments to=slack, text=Hi Mathias! How can I assist you today?.
3. Tool result: Message sent to slack (id: 3) — this is a real, successful delivery; the row landed in outbound.db and reached Slack.
4. A second assistant message follows in the SAME turn, plain text, no tool call: the exact same greeting repeated verbatim. This is the forced follow-up completion OpenCode's tool loop always requests after a tool result.
5. Our poll-loop sees step 4's bare text, finds no message-block XML wrapper in it, concludes nothing was delivered, and pushes a nudge telling the model to call send_message — even though step 2/3 already delivered successfully.

This costs at least one extra completion per turn, and if the model complies with the nudge by calling send_message again, a near-duplicate message reaches the user too.

## Root cause

Two layered issues.

### 1. OpenCode's tool-calling loop always forces one more completion after a tool result

This is a structural property of OpenAI-style function-calling APIs (and how OpenCode's Vercel-AI-SDK-based session loop works): after any tool call resolves, the loop automatically requests another completion step. It cannot know in advance whether the model wants to call another tool or is done, so it always asks. Mistral fills that mandatory follow-up with plain text, usually a near-verbatim repeat of what it just sent via the tool.

This is NOT something we can suppress from the poll-loop or MCP side. It happens inside the opencode serve process we spawn (providers/opencode.ts, spawnOpencodeServer, client.session.promptAsync). Checked for an escape hatch in the OpenCode SDK type definitions:

- SessionPromptAsyncData.body.noReply exists, but it is a flag we set on our own outer prompt call, meaning insert this text, don't run inference at all (used by plugins injecting background context). Does not affect the model's own tool-loop continuation.
- AgentConfig.maxSteps caps agentic iterations, but when the cap is hit the framework forces a text-only completion anyway (per OpenCode's own issue #19208, see below). Doesn't eliminate the round-trip; setting it to 1 doesn't help since the tool call is already step 1.
- No stopWhen-style hook (a real feature in the underlying Vercel AI SDK) is exposed through OpenCode's HTTP/SDK surface. Would require patching OpenCode's own session/prompt.ts loop, out of scope since that's vendored code we don't own.

Conclusion: the extra completion itself is unavoidable from our side. Confirmed against OpenCode's own tracker (all real, checked via GitHub API directly, not just search summaries):

- OpenCode #19208 (https://github.com/anomalyco/opencode/issues/19208) — opencode run adds empty stop-turn after tool-calls completion. Closed/fixed, but only for the case where the forced follow-up comes back empty. Doesn't help when the model actually says something, which is our case.
- OpenCode #28507 (https://github.com/anomalyco/opencode/issues/28507) — dead loop, infinite empty (tokens=0) assistant messages after a tool call with empty text. Open. Different failure mode, same problem area.
- OpenCode #26220 (https://github.com/anomalyco/opencode/issues/26220) — infinite loop after tool calls complete (Zen/big-pickle + OpenAI-compatible providers). Open. Broader and worse variant.
- OpenCode #11153 (https://github.com/anomalyco/opencode/issues/11153) — session loop doesn't stop when model returns finish_reason=stop; opposite failure mode (loop should stop, doesn't).
- OpenCode #14972 (https://github.com/anomalyco/opencode/issues/14972) and PR #14973 — OpenAI-compatible providers (Gemini, LiteLLM) returning finish_reason stop even with tool calls present, causing premature loop exit. Related but opposite direction.

Net: no OpenCode version or config avoids the extra completion in our exact case (model produces non-empty text after a tool call). Token cost of that completion's input (full context plus tool result) is unavoidable. Its output size is the only lever we have, see Partial mitigation below.

### 2. Our nudge logic treats OpenCode's forced echo as nothing was delivered

processQuery() in container/agent-runner/src/poll-loop.ts decides whether to nudge based on dispatchResultText(event.text, routing), which parses for message-block XML. That protocol is what non-OpenCode providers (Claude, etc.) use. OpenCode never uses it, its sole delivery path is the send_message MCP tool.

So for OpenCode, dispatchResultText will find zero message blocks in essentially every turn that used the tool, because the trailing forced-echo text never contains that XML, so hasUnwrapped becomes true and the nudge fires. This isn't a rare edge case: given point 1 above, it's close to the common case for any OpenCode turn that calls send_message at all.

Relevant code (as of this session):

- container/agent-runner/src/poll-loop.ts — processQuery()'s result event branch (nudge decision plus provider-aware nudge text), dispatchResultText() (the message-block parser).
- container/agent-runner/src/providers/opencode.ts — gen() async generator; resultText is built by taking the last assistant message's text from partTextByMessageId (which is the forced-echo text, since it's the last assistant message of the turn — the tool-call message has empty/no text part).
- container/agent-runner/src/db/messages-out.ts — writeMessageOut() (used by both the poll-loop's sendToDestination and the MCP send_message tool handler), getUndeliveredMessages().
- container/agent-runner/src/mcp-tools/core.ts — sendMessage tool definition; the MCP tool name as it appears in OpenCode's tool-call payload is nanoclaw_send_message (server key nanoclaw plus tool name send_message, joined by OpenCode itself).

## Cross-process constraint (important for any fix)

The MCP tool server runs as a separate OS process from poll-loop.ts (OpenCode spawns it as a bun subprocess over stdio). They share no in-memory state. The only shared state visible to both is outbound.db (SQLite, written by writeMessageOut() from either process). This constraint shaped every fix option below.

## Fix options considered

### Rejected: blunt any outbound write this turn suppresses the nudge

First idea: diff outbound.db's max seq before and after the turn; if it advanced at all, assume delivery happened and never nudge.

Problem, caught by the user: this conflates the tool was called with everything after it is a duplicate. If the model calls send_message early for a status ping and then produces a genuinely new, never-delivered final answer as trailing plain text instead of a second tool call, this approach silently swallows the real answer — worse than today, which at least nudges.

This exact mistake was independently made and caught upstream, see below.

### Validated design pattern found upstream: verbatim content match, not a boolean flag

Searched nanoclaw's actual upstream repo (nanocoai/nanoclaw) and found real, currently-open prior art. Verified via GitHub's API directly (not just AI search summaries — one search result set contained a fabricated-looking PR with a fake co-author; cross-checked everything against api.github.com before trusting it).

- nanocoai/nanoclaw PR #2531 (https://github.com/nanocoai/nanoclaw/pull/2531) — fix(poll-loop): suppress duplicate text when send_message fires mid-turn (Claude SDK provider, same underlying pattern). Open, not yet merged upstream. Key point: an earlier iteration used a boolean did send_message fire this turn flag and suppressed the entire result text on any send, but that conflates the tool was called with everything after it is a duplicate and silently dropped legitimate distinct content. The verbatim-match check is the narrower correct gate; paraphrased duplicates aren't caught, that's a deliberate tradeoff.

  Their implementation: a turn_sent_payloads JSON array in session_state (SQLite), populated by the MCP tool process, read by the poll-loop process, compared per-payload and verbatim, not a single boolean.

- nanocoai/nanoclaw issue #2404 (https://github.com/nanocoai/nanoclaw/issues/2404) — proposes a simpler mechanism: query outbound.db directly for rows with matching content written within the last roughly 60 seconds. No new state table needed.

## Recommended approach for this fork — IMPLEMENTED

Adapted issue #2404's mechanism (outbound.db content-query), scoped by seq rather than wall-clock time (immune to clock skew, and exactly turn-bound). See Update 2026-07-01 below for the full implementation and a second fix found on first live test.

### Alternative considered, not implemented: instrument OpenCode's own tool-call SSE events

The OpenCode SDK's message.part.updated events include a ToolPart when part.type is tool, with part.tool (e.g. nanoclaw_send_message) and, on completion, part.state.input.text — the exact string argument passed to the tool. Available in-process, per-turn, inside opencode.ts's gen() loop already. Would touch types.ts and opencode.ts in addition to poll-loop.ts. Left as a documented fallback if the outbound.db query approach proves too fragile.

### Either way: comparison must be content-aware, never a boolean

Both options compare content, not did a tool fire. This is the one hard lesson from the upstream PR — don't repeat the boolean mistake.

## Partial mitigation for token cost (independent of the nudge fix)

Even with the nudge-suppression fix, the wasted echo completion (point 1, root cause) still happens and still gets billed — this only cuts 3 completions (tool call, echo, nudge-retry) down to 2 (tool call, echo). Getting to 1 isn't possible without patching OpenCode itself (no exposed stop-after-tool-call hook).

The only other lever: shrink the echo's output tokens via a prompt instruction telling the model to respond with almost nothing once it has nothing further to add. Implemented as the DONE sentinel, see Update below.

## Update 2026-07-01 — fix implemented, plus a second confirmed failure mode

**Status: implemented and unit-tested (23 new/updated test cases across 3 files, full suite green apart from 2 pre-existing unrelated integration.test.ts failures). Live-tested once by the user, one gap found and patched. Not yet re-tested live after the second patch.**

### Implementation (first pass)

- db/messages-out.ts: added getMaxOutboundSeq() and hasMatchingOutboundSince(text, sinceSeq) — verbatim match, whitespace-normalized (trim plus collapse), scoped by seq (not wall-clock, immune to clock skew).
- poll-loop.ts: processQuery captures a per-turn outboundSeqCheckpoint before entering the event loop. In the OpenCode branch of the result handler, hasUnwrapped is overridden to false (suppressing the nudge) when the trailing text matches something send_message already wrote this turn. Checkpoint advances after every result event so the next turn's window only covers rows written after that point.
- destinations.ts: added an instruction telling the model about the forced follow-up and a DONE escape hatch (reply with exactly DONE if you have nothing further).
- Tests: new db/messages-out.test.ts (unit coverage of the two DB functions, including a false-positive guard for distinct content) plus new cases in poll-loop.test.ts covering echo suppression, the distinct-message regression guard, and the DONE sentinel. One new case in destinations.test.ts for the prompt wording.

### Second failure mode found on first live test

User re-tested against real Mistral traffic and got the nudge to fire anyway, plus a false couldn't-be-delivered-due-to-a-formatting-error notice in Slack despite the real content having already been delivered. Pulled the actual session's outbound.db (data/v2-sessions/ag-1781098614662-lx2src/sess-1782888589118-cnbcz9) to get ground truth instead of trusting the pasted transcript fragment alone:

```
seq 3  Hi, Mathias! How can I assist you today?
seq 5  Sure, I can do that! I will send you three messages in a row to test the new message handling.
seq 7  This is the first message. Let me know if you receive it!
seq 9  This is the second message. I hope everything is working as expected.
seq 11 This is the third and final message. Thanks for testing this with me!
seq 13 I have successfully sent you three messages in a row. Is there anything else I can help you with?
seq 15 (fallback notice) My response couldn't be delivered due to a formatting error. Please resend your message.   <- the false notice
```

session_state showed a continuation record created at the same timestamp as seq 3, i.e. this was a brand-new session, not a resumed one with old finish-tag history baked in. That rules out a stale-session-inherited-an-old-convention theory. Also confirmed via grep across every .instructions.md / CLAUDE.md file and destinations.ts that the finish tag does not appear anywhere in the current prompt.

**Conclusion: this is Mistral's own native agentic-completion habit, not inherited context and not a leftover instruction.** The model keeps reaching for a bare internal-tag-plus-finish-tag pattern to signal I am done — most likely a generic convention picked up in pretraining/fine-tuning on agent traces (ReAct-style loops commonly use a finish tag), coincidentally matching this app's own former protocol name. It does this regardless of being told the sole delivery path is send_message and to reply with DONE when finished — the DONE-sentinel instruction added in the first pass was already being ignored in favor of the model's own habit, confirmed live (the seq 13 to seq 15 gap is exactly the forced follow-up after the tool call landing as the finish-tag pattern instead of DONE or a verbatim echo, so neither suppression path matched and the retry-exhausted fallback fired a false user-facing notice).

### Second fix: recognize the finish-tag pattern (and bare DONE) as a no-op directly in code, not just via prompting

Added isNoOpTrailingText(text) in poll-loop.ts: strips internal-tag content (via the existing stripInternalTags), strips any self-closing or paired finish-tag pattern, trims, and treats the result as a no-op if it's empty or is just the literal word done. This supersedes the old exact-DONE-only sentinel check — it subsumes DONE and additionally catches the finish-tag habit, all without any outbound.db lookup, since by construction there's no real content left to match.

Key design point carried over from the PR #2531 lesson: this is content-based, not did a tool fire based. A message like The meeting is at 3pm tomorrow plus a trailing finish tag correctly still returns false from this check — real content survives the strip, so it still nudges as before. Only genuinely empty-after-stripping trailing text is treated as a no-op. Test added for this exact guard.

### Why not just teach the model to use the finish tag explicitly in the prompt instead of fighting it

Considered and rejected: explicitly endorsing that tag in destinations.ts risks normalizing it as an alternative to calling send_message at all — encouraging skipping delivery entirely on turns with genuinely new content, using it as a shortcut — the opposite of what the tool-only mandate is for. Kept the taught convention as DONE (doesn't hurt, may reduce output-token waste on turns where the model does comply) and handled the finish-tag pattern defensively in code only, invisible to the prompt. Belt and suspenders: teach one thing, silently tolerate the model's real observed behavior.

### Remaining open question

No further live re-test yet after this second fix. If finish-tag-adjacent false nudges/notices recur with a different wrapper the model invents (a differently-named self-closing tag, or a plain word like Finished), the isNoOpTrailingText regex will need broadening — it currently only strips the internal tag, the finish tag (self-closing or paired), and the literal word done. Whoever hits this next: check container logs for the scratchpad line before deciding whether to widen the marker list or fall back to a fuzzier stripped-length heuristic (stripped text under N chars with no punctuation treated as filler).

## Playbook — adapting this fix when switching to a different model

All of this logic is keyed on providerName equal to opencode (see poll-loop.ts), not on any specific underlying model name. That means switching the underlying model behind the OpenCode provider — for example OPENCODE_MODEL and OPENCODE_PROVIDER in .env (see [[Clients/Personal/AgentNotes/Reference/NanoClaw/OpenCode + OpenRouter Configuration]] for the exact env vars and model-ID format) from Mistral to DeepSeek, Llama, GLM, etc. — does NOT require touching the provider-selection code. It CAN require touching the marker-recognition logic below, because the specific words or tags a model reaches for when it has nothing further to add is model-specific learned behavior, not something we control.

### Step 1 — reproduce and observe

Send a test message through the new model that should trigger exactly one send_message call (something like say hello). Watch the container logs live, grepping for the Result:, scratchpad, suppressing nudge, and couldn't-be-delivered lines.

Three outcomes:

1. No nudge, no false delivery-failure notice. Nothing to do — either the model didn't produce a forced-echo problem at all, or the existing hasMatchingOutboundSince / isNoOpTrailingText checks already happen to cover its behavior (it also defaults to DONE, or produces an empty completion).
2. Nudge fires, but the trailing text (visible in the Result log line) is a near-verbatim repeat of what send_message already sent. This should already be caught by hasMatchingOutboundSince() in db/messages-out.ts — if it is NOT being caught, the model's echo differs from the original in more than whitespace (added quotes, changed capitalization, reordered a clause, added a trailing pleasantry). See Step 2b.
3. Nudge fires, and the trailing text has no relation to anything sent — a new I-am-done convention, not the finish tag and not DONE. See Step 2a.

### Step 2a — new model, new I-am-done marker

If the model uses its own different marker (a custom end token, a bracketed status word, a plain sentence like Task complete, a small JSON status blob, etc.) instead of the finish tag:

1. Open container/agent-runner/src/poll-loop.ts, find isNoOpTrailingText().
2. Add a strip step for the new marker to the same chain, following the pattern of the existing finish-tag regex. Keep it narrow — match the specific marker text or pattern, not a broad heuristic, so real content sitting next to the marker still survives the strip (see the existing test guarding against a substantive message next to a finish tag for why this matters).
3. Add a test in poll-loop.test.ts mirroring the two existing finish-tag cases: the marker as the very first response with no tool call yet, and the marker as the forced follow-up after a real send_message call — assert both suppress the nudge and do not deliver a false notice, and that a substantive message adjacent to the marker still nudges.
4. If the marker turns out to be highly variable rather than a fixed string (the model always writes a short but slightly different closing remark), a fixed-string strip will not scale — consider a fuzzier fallback: treat trailing text as a no-op if its stripped length is under some small threshold (roughly 20 characters) and it does not look like a real sentence. Not implemented; flagged as a fallback in the Remaining open question section above.

### Step 2b — new model, echo does not verbatim-match

If the model repeats itself with small deviations (punctuation, casing, added pleasantries) rather than an exact copy:

1. hasMatchingOutboundSince() in db/messages-out.ts currently normalizes only via trim plus whitespace-collapse — nothing else.
2. Options, in order of increasing risk (per the PR #2531 lesson — content-aware, never boolean):
   - Case-insensitive comparison (lowercase both sides before comparing) — low risk, handles capitalization drift only.
   - Strip trailing punctuation before comparing — low risk.
   - Substring or prefix match, allowing for an appended pleasantry — medium risk; a model that pads every echo with extra filler could start masking genuinely new appended content this way. If you go here, add a test that a distinct second answer appended after the echoed text (not just decorative filler) still nudges, to catch that regression.
   - Full fuzzy similarity (Levenshtein or token-overlap ratio) — highest risk, not recommended unless the above are insufficient; needs a real similarity threshold decision and more borderline-case test coverage.

### Step 3 — re-run tests, redeploy

From container/agent-runner, run the poll-loop, messages-out, and destinations test files with bun test. Bind-mounted — no image rebuild needed. Kill the active container; the next spawn picks up the change. Re-run Step 1 to confirm.

### What does NOT need to change per model

- destinations.ts's taught DONE convention — keep teaching it regardless of which model is behind the provider; it is cheap insurance even for models that mostly ignore it (see the investigation above for why the finish tag itself is deliberately NOT also taught — risk of the model using it as a shortcut to skip send_message entirely).
- The send_message-only delivery mandate itself, and the seq-based turn-scoping in poll-loop.ts — these are provider-level (opencode), not model-level.
- hasMatchingOutboundSince()'s seq-baseline mechanism — only the comparison strictness (Step 2b) is a candidate for tuning, not the turn-scoping approach itself.

## Open questions still outstanding

1. Live re-test after the second (finish-tag) fix — not yet done.
2. Worth periodically checking if nanocoai/nanoclaw PR #2531 gets merged upstream, and diffing their final implementation against this one for any lessons learned during upstream review.
3. If a third distinct I-am-done wrapper shows up from the model, decide whether to keep hand-listing markers in isNoOpTrailingText or switch to a fuzzier heuristic (see the Playbook above).

## Related

- [[Clients/Personal/AgentNotes/Reference/NanoClaw/DeepSeek Missing Closing Tag — Silent Response Drop]] — a different but structurally similar poll-loop delivery bug (SSE race truncating the closing message tag, also in dispatchResultText / OpenCode provider territory)
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/Mistral Vision Images & System Prompt — OpenCode Provider Fixes]]
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/OpenCode + OpenRouter Configuration]]
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/NanoClaw Operations]]
