# 12 — UI & Rendering

## Summary (2-3 sentences)

The claw-code CLI renders LLM output through a custom terminal markdown pipeline: `pulldown-cmark` parses markdown events, `syntect` applies syntax highlighting to fenced code blocks, and `crossterm` handles ANSI escape codes for colors, cursor control, and line clearing. Streaming output arrives chunk-by-chunk from the SSE stream, is accumulated in a `MarkdownStreamState` buffer that waits for safe rendering boundaries (blank lines or closed code fences) before rendering incremental chunks through the same `TerminalRenderer`. User input is handled by `rustyline` (v15) configured with Emacs edit mode, slash-command tab completion, and multi-line input via `Ctrl+J`/`Shift+Enter`.

## Key Types & Structs

### Rendering (`render.rs`)

| Type | Description |
|------|-------------|
| `TerminalRenderer` | Core renderer. Holds a `SyntaxSet`, a `Theme` (base16-ocean.dark), and a `ColorTheme`. Methods: `render_markdown()`, `markdown_to_ansi()`, `highlight_code()`, `stream_markdown()`. Stateless per call — safe to create repeatedly. |
| `ColorTheme` | Color palette struct with fields: `heading` (Cyan), `emphasis` (Magenta), `strong` (Yellow), `inline_code` (Green), `link` (Blue), `quote` (DarkGrey), `table_border` (DarkCyan), `code_block_border` (DarkGrey), `spinner_active` (Blue), `spinner_done` (Green), `spinner_failed` (Red). |
| `Spinner` | Braille-dot progress spinner (`FRAMES: ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]`). Methods: `tick()`, `finish()`, `fail()`. Uses crossterm `SavePosition`/`RestorePosition` and `ClearType::CurrentLine` to overwrite in place. |
| `MarkdownStreamState` | Incremental streaming buffer. Accumulates text deltas via `push(renderer, delta)`, returns `Some(rendered_ansi)` when a safe boundary is found. `flush()` renders remaining content. |
| `RenderState` | Internal state machine tracking: emphasis depth, strong depth, heading level, quote depth, list stack (ordered/unordered with nesting), link stack, table state. |
| `TableState` | Accumulates table headers, rows, and current cell content. The table is rendered as a unit after `End(TagEnd::Table)`. |
| `ListKind` | Enum: `Unordered` or `Ordered { next_index: u64 }`. |
| `LinkState` | Captures `destination` URL and accumulated `text` while inside a link span. |

### Input (`input.rs`)

| Type | Description |
|------|-------------|
| `LineEditor` | Wrapper around `rustyline::Editor<SlashCommandHelper, DefaultHistory>`. Configured with `CompletionType::List`, `EditMode::Emacs`. Binds `Ctrl+J` and `Shift+Enter` to `Cmd::Newline` for multi-line input. |
| `ReadOutcome` | Enum: `Submit(String)`, `Cancel`, `Exit`. `Cancel` is returned when `Ctrl+C` is pressed with existing input; `Exit` when `Ctrl+C` is pressed on an empty line or `Ctrl+D` (EOF). |
| `SlashCommandHelper` | Implements rustyline's `Completer`, `Highlighter`, `Hinter`, `Validator`, `Helper`. Provides tab completion for slash commands. Tracks current line content via `RefCell<String>` (updated through the `Highlighter` trait's `highlight()` calls). |

### CLI Display (`main.rs`)

| Type | Description |
|------|-------------|
| `CliToolExecutor` | Implements `ToolExecutor` trait. Holds a `TerminalRenderer` and `emit_output: bool`. After each tool execution, formats and renders the tool result via `format_tool_result()` + `stream_markdown()` if output is enabled. |
| `CliPermissionPrompter` | Implements `PermissionPrompter`. Displays tool permission prompts via `println!()` and reads `stdin` for `[y/N]` responses. |
| `CliHookProgressReporter` | Implements `HookProgressReporter`. Prints hook lifecycle events (`Started`, `Completed`, `Cancelled`) to stderr. |
| `InternalPromptProgressReporter` | Used for "Ultraplan" multi-step progress. Tracks step count, phase name, detail, elapsed time. Spawns a heartbeat thread that emits periodic status updates. |
| `HookAbortMonitor` | Spawns a background thread that listens for `Ctrl+C` via `tokio::signal::ctrl_c()` and triggers the `HookAbortSignal` to cancel long-running hooks. |

## Input Handling (REPL, readline, key bindings, multi-line input)

### REPL Loop

The REPL is driven by `run_repl()` in `main.rs`:

1. Creates a `LiveCli` instance with model, permissions, and allowed tools.
2. Creates a `LineEditor` with the prompt string `"> "` and initial slash-command completions.
3. Prints the startup banner (ASCII art + session metadata) and "Connected: {model} via {provider}" line.
4. Enters `loop`:
   - Refreshes completion candidates via `cli.repl_completion_candidates()` (includes dynamic session IDs).
   - Calls `editor.read_line()`.
   - On `Submit`: trims input, checks for `/exit`/`/quit`, attempts slash-command parsing, then bare-skill dispatch, then forwards to `cli.run_turn(&trimmed)`.
   - On `Cancel`: no-op (empty loop iteration).
   - On `Exit`: persists session and breaks.

### Rustyline Configuration

- **Edit mode**: Emacs (default readline key bindings: Ctrl+A/E for home/end, Ctrl+W for word delete, etc.).
- **Completion type**: `CompletionType::List` — shows a list of matching candidates rather than cycling through them.
- **Multi-line input**: `Ctrl+J` and `Shift+Enter` are bound to `Cmd::Newline`, allowing multi-line input without submitting.
- **History**: In-memory `DefaultHistory`. Each submitted prompt is pushed to history via `editor.push_history()`. Blank entries are ignored. No persistent history file is configured.

### Tab Completion

`SlashCommandHelper` provides tab completion for slash commands:

- Only activates when the line starts with `/` and the cursor is at the end of the line.
- Candidates include static commands (`/help`, `/status`, `/compact`, `/model`, `/model opus`, `/model sonnet`, etc.) plus dynamic entries (`/resume {session_id}`, `/session switch {session_id}`) for up to 10 recent sessions.
- Candidates are normalized: only strings starting with `/` are kept, duplicates removed via `BTreeSet`.
- Completions are refreshed at the top of each REPL iteration to include newly created sessions.

### Non-TTY Fallback

When `stdin` or `stdout` is not a terminal, `read_line_fallback()` is used: prints the prompt, reads a single line from stdin, strips trailing newlines. Returns `Exit` on EOF (pipe closed).

### Interrupt Handling

- `Ctrl+C` with non-empty input buffer: `ReadOutcome::Cancel` (clears current input, does not exit).
- `Ctrl+C` with empty buffer: `ReadOutcome::Exit` (exits the REPL).
- `Ctrl+D` (EOF): `ReadOutcome::Exit`.

The `Highlighter` trait implementation on `SlashCommandHelper` is used as a side channel to track the current line content (via `set_current_line()` in `highlight()` and `highlight_char()`), which is needed to distinguish between empty-line and non-empty-line `Ctrl+C` behavior.

## Output Rendering (how LLM responses are displayed — streaming, markdown, syntax highlighting)

### Streaming Architecture

Streaming works **chunk-by-chunk** (not character-by-character), with markdown-aware boundary detection:

1. **SSE stream**: `AnthropicRuntimeClient::consume_stream()` calls `stream.next_event()` in a loop, processing `ApiStreamEvent` variants.
2. **Text deltas**: `ContentBlockDelta::TextDelta { text }` events push text into `MarkdownStreamState::push(renderer, &text)`.
3. **Boundary detection**: `find_stream_safe_boundary()` scans the accumulated buffer for safe split points:
   - Tracks open/close code fences (respecting backtick vs tilde and fence length).
   - Only splits at **blank lines** that are **outside** a code block.
   - Returns `None` if no safe boundary exists yet (accumulates more).
4. **Incremental render**: When a boundary is found, the content up to that point is extracted, rendered via `renderer.markdown_to_ansi()`, written to stdout, and flushed. The remainder stays in the buffer.
5. **Flush on block stop**: When `ContentBlockStop` or `MessageStop` events arrive, `markdown_stream.flush()` renders any remaining buffered content.

This design ensures that partial code blocks, lists, or headings are never split mid-element, preventing rendering artifacts during streaming.

### Markdown Rendering Pipeline

`TerminalRenderer::render_markdown()`:

1. **Pre-processing**: `normalize_nested_fences()` detects and fixes nested code fences. When an outer fence (e.g., triple backticks) contains inner fences of equal or greater length, the outer fence is upgraded to use more backticks. This is critical because LLMs frequently emit nested code blocks.
2. **Parsing**: `pulldown_cmark::Parser::new_ext(&normalized, Options::all())` parses the normalized markdown with all extensions enabled (tables, footnotes, task lists, strikethrough, etc.).
3. **Event-driven rendering**: Each `pulldown_cmark::Event` is processed by `render_event()`:
   - **Headings**: H1 = bold + cyan, H2 = bold + white, H3 = blue, H4+ = grey.
   - **Emphasis**: Italic via ANSI, colored magenta.
   - **Strong**: Bold via ANSI, colored yellow.
   - **Inline code**: Backtick-wrapped, colored green.
   - **Links**: Rendered as `[text](url)` with underline + blue color.
   - **Images**: Rendered as `[image:url]` with blue color.
   - **Block quotes**: Prefixed with `│ ` in grey.
   - **Lists**: Unordered uses `•`, ordered uses `{n}. `. Nested lists are indented with 2 spaces per level.
   - **Tables**: Accumulated in `TableState`, rendered as a unit with `│` borders and `─`/`┼` separators, using column-width alignment. Headers are bold + cyan.
   - **Code blocks**: Accumulated in a buffer, then syntax-highlighted and wrapped in `╭─ {language}` / `╰─` borders.
   - **Task list markers**: `[x] ` or `[ ] `.
   - **Rules**: Rendered as `---`.

### Syntax Highlighting

`TerminalRenderer::highlight_code()`:

1. Looks up the language syntax via `syntax_set.find_syntax_by_token(language)`. Falls back to plain text.
2. Uses `syntect::easy::HighlightLines` with the `base16-ocean.dark` theme (loaded from syntect defaults).
3. Processes line-by-line with `LinesWithEndings::from(code)`.
4. For each line: `highlight_line()` returns colored ranges, which are converted to 24-bit ANSI escape sequences via `as_24_bit_terminal_escaped()`.
5. `apply_code_block_background()` wraps each line with ANSI background color 236 (dark grey), providing a visual code-block background. It replaces reset sequences inside the line to maintain the background.

### Output Control

`AnthropicRuntimeClient` has an `emit_output: bool` flag. When `false` (e.g., compact/JSON output modes), all output goes to `io::sink()` instead of `io::stdout()`. The same collected `Vec<AssistantEvent>` is returned to the conversation loop regardless.

## Tool Output Display (how tool results are shown to the user)

### Tool Call Start Display

When a tool use block is fully accumulated (input JSON complete at `ContentBlockStop`), `format_tool_call_start(name, input)` renders a framed display:

```
╭─ {tool_name} ─╮
│ {detail}
╰───────────────╯
```

Tool-specific formatting:
- **bash**: Shows `$ {command}` with dark background (ANSI 236/255).
- **read_file/Read**: Shows `📄 Reading {path}...` in dim text.
- **write_file/Write**: Shows `✏️ Writing {path} ({lines} lines)` in green+bold.
- **edit_file/Edit**: Shows `📝 Editing {path}` in yellow+bold, plus a patch preview (old line in red, new line in green).
- **glob_search/Glob**: Shows `🔎 Glob {pattern}` with scope.
- **grep_search/Grep**: Shows `🔎 Grep {pattern}` with scope.
- **web_search/WebSearch**: Shows the query.
- **Other tools**: Shows a truncated JSON summary of the payload.

### Tool Result Display

After tool execution, `CliToolExecutor::execute()` calls `format_tool_result(name, output, is_error)` and renders via `renderer.stream_markdown()`:

- **Success icon**: `✓` (green+bold).
- **Error icon**: `✗` (red+bold).
- **Error results**: Truncated to 160 chars, displayed in red (ANSI 203).

Tool-specific result formatting:
- **bash**: Shows `✓ bash` with return code interpretation. Stdout displayed as truncated text; stderr in red. Backgrounded tasks show the task ID.
- **read_file/Read**: Shows `✓ 📄 Read {path} (lines X-Y of Z)` with content preview.
- **write_file/Write**: Shows `✓ ✏️ Wrote/Updated {path} ({lines} lines)`.
- **edit_file/Edit**: Shows `✓ 📝 Edited {path}` with structured patch preview (diff lines colored: `+` green, `-` red).
- **glob_search/Glob**: Shows match count and up to 8 filenames.
- **grep_search/Grep**: Shows match/file counts and content preview or filenames.
- **Generic**: Pretty-printed JSON, truncated.

### Output Truncation Constants

- `READ_DISPLAY_MAX_LINES`: 80 lines
- `READ_DISPLAY_MAX_CHARS`: 6,000 chars
- `TOOL_OUTPUT_DISPLAY_MAX_LINES`: 60 lines
- `TOOL_OUTPUT_DISPLAY_MAX_CHARS`: 4,000 chars
- Truncated output shows: `… output truncated for display; full result preserved in session.` in dim text.

The full tool output is always preserved in the session — truncation is purely for display.

## Progress & Status (spinners, status lines, progress indicators)

### Turn-Level Spinner

`LiveCli::run_turn()` creates a `Spinner` and immediately calls `tick("🦀 Thinking...", ...)` to display a braille-dot spinner. The spinner:
- Uses crossterm `SavePosition`/`RestorePosition`, `MoveToColumn(0)`, `Clear(ClearType::CurrentLine)` to overwrite itself in place.
- On success: `spinner.finish("✨ Done", ...)` — shows green checkmark and label.
- On error: `spinner.fail("❌ Request failed", ...)` — shows red X and label.

Important: the spinner only ticks **once** at the start of the turn. There is no periodic tick loop — the spinner frame is static because `run_turn()` is a blocking call. The braille animation frames exist but are only advanced on explicit `tick()` calls.

### Ultraplan Progress Reporting

`InternalPromptProgressReporter` provides structured progress for multi-step operations:
- **Lifecycle events**: Started, Update, Heartbeat, Complete, Failed.
- **Step tracking**: Increments step counter on each model call and tool execution.
- **Phase labels**: "analyzing request", "reviewing findings", "running {tool_name}".
- **Detail descriptions**: Tool-specific summaries (e.g., "command $ git status", "reading /path/to/file").
- **Heartbeat thread**: Spawns a dedicated thread that emits periodic heartbeat lines at `INTERNAL_PROGRESS_HEARTBEAT_INTERVAL`, showing elapsed time.
- **Output format**: Lines like:
  - `🧭 Ultraplan status · planning started · current step pending · phase planning started · task: {task}`
  - `… Ultraplan status · current step 3 · phase running bash · command $ git diff`
  - `✔ Ultraplan status · completed · 12s elapsed · 5 steps total`
  - `✘ Ultraplan status · failed · 8s elapsed · tool execution failed`

### Hook Progress

`CliHookProgressReporter` prints hook lifecycle to stderr:
- `[hook pre_tool_use] {tool_name}: {command}`
- `[hook done pre_tool_use] {tool_name}: {command}`
- `[hook cancelled pre_tool_use] {tool_name}: {command}`

### Thinking Blocks

When the model emits extended thinking blocks:
- Normal thinking: `▶ Thinking ({char_count} chars hidden)`
- Streaming thinking delta (no char count yet): `▶ Thinking hidden`
- Redacted thinking: `▶ Thinking block hidden by provider`

The actual thinking content is never displayed to the user; only a summary line is shown.

### Auto-Compaction Notice

When auto-compaction fires after a turn:
```
format_auto_compaction_notice(removed_message_count)
```
This is printed after the spinner finishes, before the next prompt.

## Terminal Management (raw mode, screen clearing, resize handling)

### No Raw Mode or Alternate Screen

The CLI does **not** use crossterm's raw mode (`enable_raw_mode()`), alternate screen, or any full-screen TUI framework. It operates as a standard line-oriented terminal application. Rustyline manages its own terminal mode internally during `readline()` calls.

### Crossterm Usage

Crossterm is used solely for:
- **Cursor control**: `SavePosition`, `RestorePosition`, `MoveToColumn(0)` — used by the `Spinner` to overwrite its own line.
- **Line clearing**: `Clear(ClearType::CurrentLine)` — used by the `Spinner` to clear its display before re-drawing.
- **Color output**: `SetForegroundColor`, `ResetColor`, `Print` — used by the `Spinner`.
- **Styling**: `Stylize` trait (`.bold()`, `.italic()`, `.underlined()`, `.with(Color)`) — used throughout `render.rs` for styled markdown output.

### No Resize Handling

There is no terminal resize handling (`SIGWINCH`). Output is not reflowed on terminal width changes. The table renderer computes column widths based on content but does not consult the terminal width.

### ANSI Escape Codes

Many tool display functions use raw ANSI escape sequences directly (e.g., `\x1b[2m` for dim, `\x1b[1;32m` for bold green, `\x1b[38;5;245m` for grey-245) rather than going through crossterm's `Stylize` API. This is a style inconsistency — `render.rs` uses crossterm's API while `main.rs` tool formatters use raw escape codes.

## Integration Points (reference types from doc 04)

### ConversationRuntime -> UI Display Path

The `ApiClient::stream()` trait implementation (`AnthropicRuntimeClient::stream()`) is where streaming UI happens. The conversation loop in `runtime/src/conversation.rs` calls `self.api_client.stream(request)` and receives a collected `Vec<AssistantEvent>`. All real-time display (text streaming, tool call boxes, thinking summaries) happens **inside** this `stream()` implementation, before the events are returned to the runtime.

This means:
- The conversation loop itself has **no visibility** into streaming display.
- Display is an implementation detail of the CLI's `ApiClient` implementation.
- The `emit_output` flag controls whether display happens or not.

### ToolExecutor -> UI Display Path

`CliToolExecutor::execute()` handles tool result display. After executing a tool (via `tool_registry.execute()`), it formats the result with `format_tool_result()` and renders it via `renderer.stream_markdown()`. The conversation loop calls `tool_executor.execute()` and receives the string result — display is again an implementation detail.

### Session -> Startup Banner

`LiveCli::startup_banner()` reads session metadata (`session.id`, `session.path`), workspace context (`git_branch`, `git_summary`), and permission mode to build the ASCII art startup display.

### PermissionPolicy -> CliPermissionPrompter

The conversation loop calls `permission_policy.authorize_with_context(tool_name, input, context, prompter)` passing `CliPermissionPrompter`. When interactive approval is needed, the prompter prints the permission request and blocks on stdin. This means **the REPL is blocked** during permission prompts — there is no concurrent rendering.

### HookAbortSignal -> HookAbortMonitor

`HookAbortMonitor::spawn()` creates a background thread that waits for `Ctrl+C` (via `tokio::signal::ctrl_c()`) during hook execution. If the user presses `Ctrl+C`, `abort_signal.abort()` is called, which cancels the running hook. The monitor is stopped after each turn completes.

## Open Questions

1. **Spinner does not animate**: `Spinner::tick()` is only called once at the start of `run_turn()`. Since `run_turn()` blocks until the API response is fully consumed, the braille spinner frame never advances. The 10-frame animation array suggests animation was intended but is not implemented. A separate thread or async tick loop would be needed for animation.

2. **No streaming during the conversation loop's view**: The conversation loop (`ConversationRuntime::run_turn()`) sees only collected events. If the SSE connection stalls mid-stream, the user sees a frozen display with no feedback (except the Ultraplan heartbeat, if active). The Spinner has already been ticked once and stopped.

3. **Inconsistent ANSI styling**: `render.rs` uses crossterm's `Stylize` trait for safe, composable ANSI output. `main.rs` tool formatters use raw escape sequences (e.g., `\x1b[38;5;245m`). This makes it harder to implement theme switching or respect `NO_COLOR`/`TERM` environment variables.

4. **Tool display and streaming text can interleave**: During `consume_stream()`, text deltas and tool-use blocks are processed sequentially from the SSE stream. Text is rendered incrementally, then tool call boxes appear inline. But because tool JSON input arrives incrementally via `InputJsonDelta` and is only displayed at `ContentBlockStop`, there's a natural separation. However, if the model emits text after a tool-use block in the same response, both will appear on stdout without clear visual separation.

5. **No `NO_COLOR` or `CLICOLOR` support**: The renderer always emits ANSI escape codes. There is no mechanism to disable colors based on `NO_COLOR`, `CLICOLOR`, or `TERM=dumb` environment variables.

6. **Table rendering does not consider terminal width**: Column widths are computed from content width only. Wide tables may wrap awkwardly on narrow terminals.

7. **Permission prompt blocking**: When `CliPermissionPrompter::decide()` is called, it reads from stdin synchronously. If the user is in the middle of seeing streaming output, the permission prompt appears inline. There's no visual delineation (cursor positioning, screen clearing) to separate the prompt from the conversation output.

8. **`TerminalRenderer::new()` is called repeatedly**: Throughout `main.rs`, `TerminalRenderer::new()` is called multiple times (e.g., once per `Spinner::tick/finish/fail`, once per `push_output_block`). Each construction loads `SyntaxSet::load_defaults_newlines()` and the theme set. This is likely a minor performance concern since syntect defaults are loaded from compiled-in data, but the renderer could be shared.

9. **History is in-memory only**: `rustyline`'s history is not persisted to a file across sessions. The session's `prompt_history` is persisted in JSONL, but rustyline's readline history (arrow-key recall) is lost when the REPL exits.

10. **Multi-line input UX**: While `Ctrl+J` and `Shift+Enter` are bound for newline input, there is no visual indicator (like a continuation prompt such as `... `) for subsequent lines. The user types into the same `> ` prompt context.

## Key Files Read

| File | Absolute Path |
|------|---------------|
| render.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/rusty-claude-cli/src/render.rs` |
| input.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/rusty-claude-cli/src/input.rs` |
| main.rs (partial — streaming, tool display, spinner, permission prompt, startup banner, progress reporting, REPL loop) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/rusty-claude-cli/src/main.rs` |
| Cargo.toml | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/rusty-claude-cli/Cargo.toml` |
| 04 - Conversation Loop & Sessions.md (Obsidian, prior context) | `Clients/Netlight/AgentNotes/Reference/Claw Code Architecture/04 - Conversation Loop & Sessions.md` |

### Dependencies Relevant to UI

| Crate | Version | Purpose |
|-------|---------|---------|
| `crossterm` | 0.28 | Terminal cursor control, line clearing, color/style output, spinner rendering |
| `pulldown-cmark` | 0.13 | CommonMark markdown parsing (event-driven) with all extensions |
| `rustyline` | 15 | Line editing, history, tab completion, key bindings (Emacs mode) |
| `syntect` | 5 | Syntax highlighting for code blocks (base16-ocean.dark theme) |
| `tokio` | 1 (rt-multi-thread, signal, time) | Async runtime for SSE streaming, Ctrl+C signal handling, stall timeouts |
