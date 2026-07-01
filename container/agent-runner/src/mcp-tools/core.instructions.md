## Sending messages

Which mechanism delivers your response — a tool call or a `<message>` text block — is specified in the **`## Sending messages`** section of your runtime system prompt. Follow that exactly; this section only documents the tool APIs.

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
