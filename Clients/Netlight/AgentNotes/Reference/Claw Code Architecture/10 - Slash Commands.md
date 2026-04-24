# 10 — Slash Commands

## Summary (2-3 sentences)

Slash commands are the primary non-conversational interaction surface in claw-code: any REPL input beginning with `/` is intercepted before reaching the conversation loop and dispatched to a handler function inside `LiveCli`. The system is built around a statically defined `SLASH_COMMAND_SPECS` table of 100+ command specifications in the `commands` crate, a `SlashCommand` enum that models the parsed command with its arguments, and a `validate_slash_command_input()` parser that converts raw text into a `SlashCommand` variant. A large subset of the defined commands are currently stubs (tracked via the `STUB_COMMANDS` constant in main.rs) — they are registered in the spec table for forward-compatibility and tab-completion groundwork but print "not yet implemented" when invoked.

## Key Types & Structs

### Commands Crate (`commands/src/lib.rs`)

| Type | Description |
|------|-------------|
| `SlashCommandSpec` | Static specification for a single command: `name: &'static str`, `aliases: &'static [&'static str]`, `summary: &'static str`, `argument_hint: Option<&'static str>`, `resume_supported: bool`. Stored in the `SLASH_COMMAND_SPECS` const array. |
| `SlashCommand` | Enum with ~60 variants representing each parsed slash command and its arguments (e.g., `Model { model: Option<String> }`, `Session { action: Option<String>, target: Option<String> }`, `Unknown(String)`). Has a `parse(input) -> Result<Option<Self>, SlashCommandParseError>` constructor and a `slash_name() -> &'static str` helper. |
| `SlashCommandParseError` | Error type with a formatted `message: String` that includes usage hints, detail lines, and contextual help. |
| `CommandRegistry` | Simple wrapper around `Vec<CommandManifestEntry>` — used by the `dump-manifests` subcommand, not by runtime dispatch. |
| `CommandManifestEntry` | Entry: `name: String`, `source: CommandSource`. |
| `CommandSource` | Enum: `Builtin`, `InternalOnly`, `FeatureGated`. |
| `SkillSlashDispatch` | Enum: `Local` (handle locally — list/install/help) or `Invoke(String)` (forward as a prompt to the LLM via `run_turn`). |
| `SlashCommandResult` | `message: String`, `session: Session` — returned by some resume-mode command handlers. |
| `PluginsCommandResult` | `message: String`, `reload_runtime: bool` — returned by plugin management commands. |

### CLI Layer (`rusty-claude-cli/src/main.rs`)

| Type | Description |
|------|-------------|
| `STUB_COMMANDS` | `&[&str]` constant listing ~75 command names that are defined in the spec table but not yet implemented. Used to filter completions, help output, and resume-mode dispatch. |
| `ResumeCommandOutcome` | `session: Session`, `message: Option<String>`, `json: Option<serde_json::Value>` — result of running a slash command in `--resume` mode against a loaded session file. |
| `StatusContext` | Aggregation of workspace, git, config, and sandbox state for the `/status` command. |
| `StatusUsage` | Token usage snapshot: `message_count`, `turns`, `latest`/`cumulative` `TokenUsage`, `estimated_tokens`. |

### Input Layer (`rusty-claude-cli/src/input.rs`)

| Type | Description |
|------|-------------|
| `LineEditor` | Wraps `rustyline::Editor` with a `SlashCommandHelper` for tab-completion of slash commands. |
| `SlashCommandHelper` | Implements `rustyline::Completer` — filters a `Vec<String>` of completion candidates (each prefixed with `/`) by matching the current line prefix. Also tracks the current line buffer via the `Highlighter` trait for cancel detection. |
| `ReadOutcome` | Enum: `Submit(String)`, `Cancel`, `Exit`. |

## Command Registry (how commands are registered, discovered)

**Registration is fully static.** The `SLASH_COMMAND_SPECS` constant in `commands/src/lib.rs` is a `&[SlashCommandSpec]` array containing 100+ entries. There is no dynamic registration mechanism — all commands are hardcoded at compile time. The public accessor `slash_command_specs()` returns this static slice.

**Discovery surfaces:**

1. **Tab completion** — `slash_command_completion_candidates_with_sessions()` iterates `slash_command_specs()`, filters out `STUB_COMMANDS`, and builds a `BTreeSet<String>` of `/name` strings plus expanded argument completions (e.g., `/model opus`, `/permissions read-only`, `/session switch <recent-id>`).

2. **Help output** — `render_slash_command_help()` and `render_slash_command_help_filtered(exclude)` group commands by category ("Session", "Tools", "Config", "Debug") using `slash_command_category()` and render formatted help lines.

3. **Manifest dump** — `CommandRegistry` is populated from `slash_command_specs()` for the `claw dump-manifests` subcommand, including the `CommandSource` classification.

**Category assignment** — `slash_command_category(name)` maps each command name to one of four categories via a static match expression:
- **Session**: help, status, cost, resume, session, version, usage, stats, clear, compact, history, exit, etc.
- **Config**: model, permissions, config, memory, theme, vim, voice, color, effort, fast, etc.
- **Debug**: debug-tool-call, doctor, sandbox, diagnostics, tool-details, changelog, metrics
- **Tools**: everything else (default)

## Built-in Commands (implemented — not in STUB_COMMANDS)

### Session Category

| Command | What it does |
|---------|--------------|
| `/help` | Renders the full help output including all non-stub commands grouped by category, plus keyboard shortcuts. |
| `/status` | Prints model, permission mode, workspace, git branch, session info, token usage, config file counts, memory file counts, sandbox status. Calls `format_status_report()`. |
| `/compact` | Runs `ConversationRuntime::compact(CompactionConfig::default())`, rebuilds the runtime with the compacted session, persists, and prints a report with removed/kept message counts. |
| `/clear [--confirm]` | Without `--confirm`: prints a confirmation prompt. With `--confirm`: creates a fresh `Session`, new `SessionHandle`, new `BuiltRuntime`, preserves model and permission mode, prints the old/new session IDs. |
| `/cost` | Prints cumulative `TokenUsage` from `UsageTracker`. |
| `/resume <session-path>` | Loads a session from a JSONL file or session ID (via `load_session_reference()`), replaces the current `LiveCli` session and runtime, prints a resume report. |
| `/export [file]` | Exports the current conversation to a file. |
| `/session [list\|switch <id>\|fork [name]\|delete <id> [--force]]` | Session management: list managed sessions, switch to another session, fork the current session with a branch name, or delete a session. |
| `/history [count]` | Prints the prompt history (user inputs) from `LiveCli.prompt_history`. |
| `/stats` | Synonym for token/cost stats — runs `UsageTracker::from_session().cumulative_usage()` and prints a cost report. |

### Tools Category

| Command | What it does |
|---------|--------------|
| `/bughunter [scope]` | Prints a formatted bughunter report (currently a static template — does not run an LLM turn). |
| `/commit` | Runs `git status --short --branch`, checks if workspace is clean. If dirty, prints a preflight report with branch and summary. Does NOT create a commit — it prepares context for a subsequent LLM-driven commit. |
| `/pr [context]` | Prints a PR report template with the current git branch and optional context. |
| `/issue [context]` | Prints an issue report template with optional context. |
| `/ultraplan [task]` | Prints a formatted ultraplan report (static template). |
| `/teleport <symbol-or-path>` | Runs `render_teleport_report(target)` to search the workspace for a file or symbol match. |
| `/debug-tool-call` | Replays the last tool call from the session with debug details via `render_last_tool_debug_report()`. |
| `/diff` | Shows `git diff` output for the current workspace. |
| `/init` | Creates starter `.claw.json` and `CLAUDE.md` via `initialize_repo()`. |
| `/plugin [list\|install\|enable\|disable\|uninstall\|update]` | Full plugin lifecycle management via `PluginManager`. Returns `PluginsCommandResult` with `reload_runtime: bool` to signal whether the runtime needs rebuilding. |
| `/agents [list\|help]` | Discovers agent definitions from `discover_definition_roots(cwd, "agents")`, loads them from filesystem roots (project `.claw/agents/`, user config `~/.claw/agents/`, user home), and renders a report. |
| `/skills [list\|install <path>\|help\|<skill> [args]]` | When `classify_skills_slash_command()` returns `SkillSlashDispatch::Local`: lists/installs/shows help. When it returns `SkillSlashDispatch::Invoke(prompt)`: calls `self.run_turn(&prompt)` to execute the skill as an LLM conversation turn. |
| `/doctor` | Runs environment health diagnostics via `render_doctor_report()`. |

### Config Category

| Command | What it does |
|---------|--------------|
| `/model [model]` | Without arg: prints current model, message count, turns. With arg: resolves alias via `resolve_model_alias_with_config()`, rebuilds runtime with new model, prints switch report. |
| `/permissions [mode]` | Without arg: prints mode table showing current/available modes. With arg (read-only\|workspace-write\|danger-full-access): switches mode, rebuilds runtime, prints switch report. |
| `/config [env\|hooks\|model\|plugins]` | Inspects merged config files. Without arg: shows all loaded config files. With section: shows that specific config section. |
| `/mcp [list\|show <server>\|help]` | Inspects MCP server configuration. `list` shows all configured servers with transport type and scope. `show <server>` shows detailed config for one server. Degrades gracefully on config parse failure (#144). |
| `/memory` | Lists loaded Claude instruction memory files (CLAUDE.md, etc.). |
| `/version` | Prints CLI version and build information. |
| `/sandbox` | Prints sandbox isolation status. |

## Skill-based Commands (how plugin/skill commands integrate)

### Skill Discovery

Skills are discovered from filesystem roots via `discover_skill_roots(cwd)` and `discover_definition_roots(cwd, "skills")`. The search looks in:
- **Project roots**: `<cwd>/.claw/skills/`, `<cwd>/.claw/commands/` (legacy), `<cwd>/.claude/commands/` (Claude Code compat)
- **User config roots**: `<config_home>/skills/`, `<config_home>/commands/` (legacy), `<codex_home>/skills/`
- **User home roots**: `<home>/.claw/skills/`, `<home>/.claw/commands/` (legacy), `<home>/.claude/commands/` (Claude Code compat)

Each skill is a directory containing a `SKILL.md` file, or a standalone `.md` file in a legacy commands directory. The `SKILL.md` can contain frontmatter to define the skill name and description.

### Skill Dispatch Flow

1. User types `/skills <skill-name> [args]`
2. `validate_slash_command_input()` parses it as `SlashCommand::Skills { args: Some("<skill-name> [args]") }`
3. In `handle_repl_command()`, `classify_skills_slash_command(args)` is called:
   - If args is `None`, `"list"`, `"help"`, or starts with `"install"`: returns `SkillSlashDispatch::Local` — handled locally (list/install/help).
   - Otherwise: returns `SkillSlashDispatch::Invoke("$<skill-name> [args]")` — the `$` prefix signals a skill invocation prompt.
4. For `Invoke(prompt)`: `self.run_turn(&prompt)` is called, which sends the skill prompt through the full conversation loop (API call, tool execution, etc.). The skill's `SKILL.md` content is loaded and prepended to the prompt by the system prompt builder.

### Bare-word Skill Resolution

The REPL also supports **bare-word skill invocation** (ROADMAP #36): if user input doesn't start with `/` and the first token matches a known skill name, `try_resolve_bare_skill_prompt()` resolves it and dispatches via `run_turn()`. This uses `resolve_skill_invocation()` which validates the skill exists on disk before returning `SkillSlashDispatch::Invoke(...)`.

### Skill Validation

`resolve_skill_invocation()` calls `resolve_skill_path(cwd, skill_token)` which searches all skill roots for a matching skill. If not found, returns an error with the list of available skills.

### OMC/Claude Code Plugin Compatibility

Unknown commands with an `oh-my-claudecode:` prefix trigger a compatibility note explaining that OMC plugin slash commands are not yet supported. This is handled via `omc_compatibility_note_for_unknown_slash_command()`.

## Dispatch Flow (user types /foo — what happens?)

### Path 1: REPL Mode (interactive)

```
User types "/model opus"
    |
    v
run_repl() loop
    |
    v
input::LineEditor::read_line() -> ReadOutcome::Submit("/model opus")
    |
    v
Check: input starts with "/" -> true
    |
    v
SlashCommand::parse("/model opus")
  -> validate_slash_command_input("/model opus")
  -> strips "/", splits into command="model", args=["opus"]
  -> matches "model" arm -> optional_single_arg() -> Ok(Some("opus"))
  -> Ok(Some(SlashCommand::Model { model: Some("opus") }))
    |
    v
cli.handle_repl_command(SlashCommand::Model { model: Some("opus") })
  -> self.set_model(Some("opus"))
  -> resolve_model_alias_with_config("opus") -> "claude-opus-4-6"
  -> build_runtime(session, new_model, ...) -> new BuiltRuntime
  -> self.replace_runtime(runtime)
  -> self.model = "claude-opus-4-6"
  -> prints "Model updated\n  Previous  ...\n  Current  claude-opus-4-6"
    |
    v
handle_repl_command returns Ok(true) -> persist_session()
    |
    v
continue (back to read_line loop)
```

### Path 2: Direct CLI Mode (`claw /help`)

```
User runs: claw /help
    |
    v
parse_args(["/help"])
  -> first positional starts with "/" -> falls through to slash command handling
  -> parse_direct_slash_cli_action(["/help"], ...)
  -> SlashCommand::parse("/help") -> Ok(Some(SlashCommand::Help))
  -> maps to CliAction::Help { output_format }
    |
    v
run() dispatches CliAction::Help
  -> prints help output
```

Only a few commands work in direct CLI mode: `/help`, `/agents`, `/mcp`, `/skills` (local actions). Others return an error: "slash command X is interactive-only. Start `claw` and run it there."

### Path 3: Resume Mode (`claw --resume SESSION.jsonl /status /diff`)

```
User runs: claw --resume latest /status /diff
    |
    v
parse_resume_args(["latest", "/status", "/diff"])
  -> session_path = "latest"
  -> commands = ["/status", "/diff"]
  -> CliAction::ResumeSession { session_path, commands, output_format }
    |
    v
resume_session() loads the session from disk
    |
    v
For each command in commands:
  -> Check STUB_COMMANDS -> not a stub
  -> SlashCommand::parse("/status") -> Ok(Some(SlashCommand::Status))
  -> run_resume_command(&path, &session, &command)
  -> Returns ResumeCommandOutcome { session, message, json }
  -> Print message/json based on output_format
```

Resume mode only supports commands where `resume_supported: true` in the spec. Unsupported commands return "unsupported resumed slash command" and exit with code 2.

### Path 4: Unknown Command

```
User types "/statsu" (typo)
    |
    v
SlashCommand::parse("/statsu")
  -> validate_slash_command_input -> command="statsu"
  -> no match -> Ok(Some(SlashCommand::Unknown("statsu")))
    |
    v
handle_repl_command(SlashCommand::Unknown("statsu"))
  -> format_unknown_slash_command("statsu")
  -> suggest_slash_commands("statsu") -> uses Levenshtein distance
  -> "Unknown slash command: /statsu\n  Did you mean    /status, /stats\n  Help  /help"
```

### Path 5: Bare-word Skill Dispatch

```
User types "commit" (bare word, no slash)
    |
    v
SlashCommand::parse("commit") -> Ok(None) (no "/" prefix)
    |
    v
try_resolve_bare_skill_prompt(&cwd, "commit")
  -> checks: first token "commit" is alphanumeric
  -> resolve_skill_invocation(cwd, Some("commit"))
  -> classify_skills_slash_command(Some("commit"))
  -> SkillSlashDispatch::Invoke("$commit")
  -> resolve_skill_path(cwd, "commit") -> checks skill directories
  -> If found: returns Some("$commit")
  -> If not found: returns None -> falls through to normal run_turn("commit")
    |
    v
If skill found: cli.run_turn("$commit")
If not found: cli.run_turn("commit") (treated as user prompt)
```

## Integration Points (reference types from docs 01, 04)

### SlashCommand -> BuiltRuntime / LiveCli (doc 01)

- Several commands **rebuild the runtime**: `/model`, `/permissions`, `/clear`, `/resume`, `/compact`, `/session switch`, `/session fork`. They call `build_runtime()` to create a new `BuiltRuntime` (doc 01), then `self.replace_runtime()` which shuts down the old runtime's MCP and plugins before swapping.
- Commands that rebuild the runtime preserve the `Session` state by cloning it from the old runtime and passing it to the new one. `/clear` is the exception — it creates a fresh `Session`.
- `/compact` calls `ConversationRuntime::compact(CompactionConfig::default())` (doc 04) to produce a compacted session, then rebuilds the runtime with that session.

### SlashCommand -> Session Persistence (doc 04)

- `handle_repl_command()` returns `bool` indicating whether `persist_session()` should be called. Commands that modify session state (model switch, permission switch, clear, resume, compact, session management) return `true`; informational commands return `false`.
- `/export` calls `session.save_to_path()` to write the session to a user-specified path.
- `/clear` creates a backup of the old session via `write_session_clear_backup()` before starting fresh.

### SlashCommand -> ConversationRuntime::run_turn (doc 04)

- Skill-based commands (`SkillSlashDispatch::Invoke(prompt)`) call `self.run_turn(&prompt)`, which enters the full conversation loop (doc 04): push user message, call API, execute tools, iterate until no more tool uses.
- `/bughunter`, `/commit`, `/pr`, `/issue`, `/ultraplan` currently generate static text reports but are intended to become LLM-driven in the future (they have `resume_supported: false`).
- `run_internal_prompt_text()` is a helper that creates a temporary runtime, runs a single turn without modifying the main session, and returns the assistant's text response. Used by commands that need LLM output without affecting the conversation history.

### SlashCommand -> Configuration (doc 01)

- `/config` calls `ConfigLoader::default_for(&cwd).load()` and renders the merged config.
- `/mcp` loads config via `ConfigLoader` to enumerate MCP servers. Degrades gracefully if config fails to parse (#144).
- `/model` resolves aliases via `resolve_model_alias_with_config()` which loads config aliases (doc 01 alias resolution chain).
- `/permissions` normalizes mode strings and maps them to `PermissionMode` via `permission_mode_from_label()`.

### SlashCommand -> Plugin System (doc 01)

- `/plugin` commands interact directly with `PluginManager` (doc 01): `install()`, `enable()`, `disable()`, `uninstall()`, `update()`.
- Plugin commands that modify state return `PluginsCommandResult { reload_runtime: true }`, triggering a runtime rebuild to pick up tool registry changes.

### Tab Completion -> LineEditor (input.rs)

- `LineEditor` receives completion candidates from `slash_command_completion_candidates_with_sessions()`. Candidates include: command names, argument expansions, model names, recent session IDs.
- The `SlashCommandHelper` implements `rustyline::Completer` — when the line starts with `/`, it prefix-matches against the candidate list.
- Completions are refreshed on every REPL loop iteration via `editor.set_completions()`.

## Open Questions

1. **Many commands are stubs**: 75+ of the 100+ registered commands are in `STUB_COMMANDS` and print "not yet implemented". The spec table appears to be a forward declaration of the full planned command surface (ROADMAP #39). It's unclear whether all of these are actually planned for implementation or if some are speculative.

2. **Runtime rebuild on every state-changing command**: Commands like `/model`, `/permissions`, `/clear`, `/compact`, and `/session switch` all rebuild the entire `BuiltRuntime` (re-initializing MCP, plugins, tool registry). This is the same concern as doc 04 open question #1 — rebuilding per-turn is expensive. Some of these could potentially just mutate the existing runtime's state.

3. **Skills dispatched as LLM prompts**: When `/skills <name>` matches a skill, the dispatch is `self.run_turn("$<name>")`. The `$` prefix convention is used to signal a skill invocation to the system prompt builder. The exact mechanism for how the system prompt integrates the skill's `SKILL.md` content needs investigation in the prompt/skills category.

4. **No command middleware or hooks**: There is no pre/post-command hook mechanism for slash commands (unlike tool execution which has pre/post hooks). A plugin cannot intercept or extend slash command behavior.

5. **Resume mode is limited**: Only `resume_supported: true` commands work in `--resume` mode. The set of resume-supported commands is roughly the informational/read-only ones. State-modifying commands like `/model`, `/clear`, `/resume` itself are not supported in resume mode.

6. **`CommandRegistry` vs `SLASH_COMMAND_SPECS`**: Two parallel systems exist for command registration. `CommandRegistry` with `CommandManifestEntry`/`CommandSource` is used by `dump-manifests` but plays no role in actual dispatch. The real dispatch uses `SLASH_COMMAND_SPECS` directly. These could be unified.

7. **Parse-vs-dispatch gap**: The `SlashCommand` enum has variants for all commands including stubs, but `handle_repl_command()` only handles ~30 of them. The rest fall into a catch-all arm that prints "not yet implemented". There is a risk of the enum and spec table diverging — a new spec entry without a corresponding enum variant would parse as `Unknown`, while a new enum variant without a spec entry would not appear in help or completions.

8. **Bare-word skill resolution is aggressive**: `try_resolve_bare_skill_prompt()` checks every first token against all known skills. If a user happens to have a skill named "test" and types "test my code", it would be intercepted as a skill invocation rather than a normal prompt. The alphanumeric-only filter helps but doesn't prevent all collisions.

9. **No async command execution**: All commands execute synchronously on the main thread. Long-running commands like `/plugin install` block the REPL. The `/tasks` command exists as a stub, suggesting planned background task support.

10. **OMC compatibility is minimal**: The only Claude Code/OMC compatibility surface is a note for `oh-my-claudecode:*` commands. Claude Code's `/allowed-tools`, `/approve`, `/deny`, and other commands are defined in the spec table but are in STUB_COMMANDS.

## Key Files Read

| File | Absolute Path |
|------|---------------|
| lib.rs (commands crate) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/commands/src/lib.rs` |
| main.rs (CLI — REPL loop, handle_repl_command, resume, dispatch, completions, STUB_COMMANDS) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/rusty-claude-cli/src/main.rs` |
| input.rs (LineEditor, SlashCommandHelper, tab completion) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/rusty-claude-cli/src/input.rs` |

### Files NOT read but referenced (for later agents)

- `commands/src/lib.rs` (full — remaining rendering helpers, skill install logic, MCP report rendering, agent/skill discovery)
- `main.rs` (full — all LiveCli methods, format_* functions, teleport, bughunter report templates, session management, doctor diagnostics)
- `runtime/src/compact.rs` — `compact_session()`, `CompactionConfig`, compaction algorithm (covered in doc 04)
- `runtime/src/session_control.rs` — `SessionStore`, session listing/loading/forking
- `plugins/src/lib.rs` — `PluginManager`, `PluginRegistry`, plugin lifecycle
- `runtime/src/prompt.rs` — how skill `SKILL.md` content is integrated into system prompts