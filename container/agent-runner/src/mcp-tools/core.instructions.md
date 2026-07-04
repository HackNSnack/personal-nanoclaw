## Sending messages

Which mechanism delivers your response — a tool call or a `<message>` text block — is specified in the **`## Sending messages`** section of your runtime system prompt. Follow that exactly; this section only documents the tool APIs.

### Ending a turn (read this first)

There is no text-based way to end a turn — no sentinel word or tag (`<finish/>`, `DONE`, etc.)
closes anything. Turn completion is a structural signal only: `send_message(..., final: true)`
or `end_turn()`. If your delivery model uses the `send_message` tool at all, one of those two
calls is mandatory before your response is considered complete.

`final: true` is about THIS TURN, not the whole request: it means "I'm about to go quiet and
wait for the user," not "the user's request is now fully and permanently resolved." A one-line
reply to "hi" is `final: true`. Reporting that you scheduled a recurring task is `final: true`
even though the task itself keeps firing later — your turn producing that message is over.
Only set `final: false` when you are about to call another tool or send another message within
this same turn, immediately, before waiting for the user again.

**Plain text output is never seen by the user, under any circumstances.** If your delivery model
uses `send_message` at all, the ONLY thing that reaches the user is the literal string you pass
as `text` in that tool call. Text you write outside a tool call — no matter how long, complete,
or final it looks to you — is discarded silently before the user ever sees it; it is not queued,
not appended, not shown "anyway." If you catch yourself having written a full answer as plain
text, that answer does not exist yet. Call `send_message` with that same full answer as `text`.
Do not respond to a "you didn't close the turn" nudge by sending a shorter placeholder just to
satisfy the tool-call requirement — that discards the real answer and delivers a worse one for
no reason. The fix is always to send the complete thing, via the tool, verbatim.

### `send_message`

Sends a message to a named destination. If you have only one destination, `to` is optional.

Whether you call this once, multiple times (status updates + final answer), or not at all for delivery depends on your system prompt's delivery model — check it before relying on the pacing guidance below.

- **Short turn:** No status needed.
- **Longer turn:** One brief acknowledgment at the start, then the complete answer.
- **Long-running turn:** Periodic one-line status updates at natural milestones, then a final message with the complete result.

### Sending files (`send_file`)

Use `mcp__nanoclaw__send_file({ path, text?, filename?, to? })` to deliver a file from your workspace. `path` is absolute or relative to `/workspace/agent/`; `filename` overrides the display name shown in chat (defaults to the file's basename); `text` is an optional accompanying message. Use this for artifacts you produce (charts, PDFs, generated images, reports) rather than dumping contents into chat.

### Reacting to messages (`add_reaction`)

Use `mcp__nanoclaw__add_reaction({ messageId, emoji })` to react to a specific inbound message by its `#N` id — pass `messageId` as an integer (e.g. `22`, not `"22"`). Good for lightweight acknowledgment (`eyes` = seen, `white_check_mark` = done) when a full reply would be noise. `emoji` is the shortcode name (e.g. `thumbs_up`, `heart`), not the raw character.

### Internal thoughts

Wrap reasoning in `<internal>...</internal>` tags to mark it as scratchpad — logged but not sent.
