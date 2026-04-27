# 03 — Prompt Handling

## Summary (2-3 sentences)

The Prompt Handling system (`runtime/src/prompt.rs`) assembles the system prompt that governs every conversation turn. `SystemPromptBuilder` produces an ordered `Vec<String>` of sections — static behavioral instructions, a dynamic boundary marker, environment metadata, git context, discovered CLAUDE.md instruction files, and merged runtime config — which is stored in `LiveCli` at bootstrap, cloned into every `ConversationRuntime` instance, and joined into a single string only at the API wire boundary when `AnthropicRuntimeClient::stream()` builds the `MessageRequest`. A `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` sentinel separates cache-stable static content from per-session dynamic content, though this boundary is not currently consumed by the prompt caching layer (which fingerprints the entire serialized `system` field).

## Key Types & Structs

### prompt.rs

| Type | Description |
|------|-------------|
| `SystemPromptBuilder` | Builder for the system prompt. Fields: `output_style_name`, `output_style_prompt`, `os_name`, `os_version`, `append_sections: Vec<String>`, `project_context: Option<ProjectContext>`, `config: Option<RuntimeConfig>`. Key methods: `build() -> Vec<String>`, `render() -> String` (joins sections with double newlines). |
| `ProjectContext` | Project-local context gathered at startup. Fields: `cwd: PathBuf`, `current_date: String`, `git_status: Option<String>`, `git_diff: Option<String>`, `git_context: Option<GitContext>`, `instruction_files: Vec<ContextFile>`. Constructors: `discover()` (instruction files only), `discover_with_git()` (adds git status, diff, and full `GitContext`). |
| `ContextFile` | A discovered instruction file: `path: PathBuf`, `content: String`. |
| `PromptBuildError` | Error enum with `Io(std::io::Error)` and `Config(ConfigError)` variants, raised by `load_system_prompt()`. |
| `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` | String constant `"__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__"` inserted between static instruction sections and dynamic environment sections. Currently not consumed by any downstream code — it exists as a marker for future prompt-caching optimization. |
| `FRONTIER_MODEL_NAME` | String constant `"Claude Opus 4.6"` — the human-readable model family name injected into the environment section of every system prompt. |
| `MAX_INSTRUCTION_FILE_CHARS` | `4_000` — per-file character cap for instruction file content. |
| `MAX_TOTAL_INSTRUCTION_CHARS` | `12_000` — total character budget across all instruction files. |

### git_context.rs

| Type | Description |
|------|-------------|
| `GitContext` | Git-aware context: `branch: Option<String>`, `recent_commits: Vec<GitCommitEntry>`, `staged_files: Vec<String>`. Constructed via `detect(cwd)` which runs `git rev-parse`, `git rev-parse --abbrev-ref HEAD`, `git log --oneline -n 5`, and `git diff --cached --name-only`. |
| `GitCommitEntry` | A single commit: `hash: String`, `subject: String`. |

### conversation.rs (consumer)

| Type | Description |
|------|-------------|
| `ApiRequest` | The wire-level request struct: `system_prompt: Vec<String>`, `messages: Vec<ConversationMessage>`. Constructed in the conversation loop with `self.system_prompt.clone()`. |

## Flow (step-by-step: how is the system prompt assembled?)

### 1. Entry Point — `build_system_prompt()` in main.rs

During `LiveCli::new()`, the CLI calls `build_system_prompt()` which delegates to the runtime's `load_system_prompt()`:

```
build_system_prompt()
  → load_system_prompt(cwd, DEFAULT_DATE, OS, "unknown")
```

`DEFAULT_DATE` is a build-time constant injected by `build.rs` (via `cargo:rustc-env=BUILD_DATE=...`), resolved from `SOURCE_DATE_EPOCH` env, `BUILD_DATE` env, or the `date +%Y-%m-%d` command. Falls back to `"unknown"`.

### 2. `load_system_prompt()` — Orchestrator

```rust
pub fn load_system_prompt(cwd, current_date, os_name, os_version) -> Result<Vec<String>, PromptBuildError>
```

1. Calls `ProjectContext::discover_with_git(&cwd, current_date)` — discovers instruction files + git state.
2. Calls `ConfigLoader::default_for(&cwd).load()` — loads and merges all config files into a `RuntimeConfig`.
3. Builds and returns `SystemPromptBuilder::new().with_os(...).with_project_context(...).with_runtime_config(...).build()`.

Note: This is a **second** config load — the same config is loaded independently in `build_runtime_plugin_state()`. There is no shared cache between these two loads (see Open Question from doc 01).

### 3. `ProjectContext::discover_with_git()` — Context Gathering

1. Calls `discover_instruction_files(cwd)`:
   - Walks from filesystem root to `cwd`, collecting ancestor directories (then reverses to root-first order).
   - For each directory, checks four candidate paths: `CLAUDE.md`, `CLAUDE.local.md`, `.claw/CLAUDE.md`, `.claw/instructions.md`.
   - Reads each file, skips empty/missing, collects into `Vec<ContextFile>`.
   - Deduplicates by content hash (normalized: collapsed blank lines, trimmed) using `DefaultHasher`.
2. Calls `read_git_status(cwd)` — runs `git --no-optional-locks status --short --branch`.
3. Calls `read_git_diff(cwd)` — runs `git diff --cached` (staged) and `git diff` (unstaged), combines if non-empty.
4. Calls `GitContext::detect(cwd)` — runs `git rev-parse --is-inside-work-tree`, then collects branch name, last 5 commits, and staged file names.

### 4. `SystemPromptBuilder::build()` — Section Assembly

Returns `Vec<String>` with sections in this exact order:

| Index | Section | Function | Description |
|-------|---------|----------|-------------|
| 0 | Intro | `get_simple_intro_section()` | "You are an interactive agent that helps users with software engineering tasks..." (varies if output style is set) |
| 1* | Output Style | (conditional) | `# Output Style: {name}\n{prompt}` — only present when `with_output_style()` was called |
| 2 | System | `get_simple_system_section()` | Bulleted rules: text is displayed to user, tools need permission, system-reminder tags, prompt injection flagging, hook behavior, auto-compression |
| 3 | Doing Tasks | `get_simple_doing_tasks_section()` | Bulleted rules: read before changing, no speculative abstractions, no unnecessary files, diagnose before switching, no security vulnerabilities, report outcomes faithfully |
| 4 | Actions | `get_actions_section()` | "Executing actions with care" — consider reversibility and blast radius |
| 5 | **DYNAMIC BOUNDARY** | literal string | `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` |
| 6 | Environment | `environment_section()` | Model family, working directory, date, platform+OS version |
| 7 | Project Context | `render_project_context()` | Date, cwd, instruction file count, git status snapshot, recent commits, git diff snapshot, full git context render (branch, commits, staged files) |
| 8 | Instruction Files | `render_instruction_files()` | Each discovered CLAUDE.md/instructions.md file, with scope annotation, truncated per-file to 4K chars and total to 12K chars |
| 9 | Config | `render_config_section()` | Lists loaded config entries (path + scope), then renders the full merged JSON via `RuntimeConfig::as_json().render()` |
| 10+ | Appended Sections | `append_sections` | Any additional sections added via `append_section()` |

*The output style section shifts all subsequent indices by 1 when present.

### 5. Prompt Storage and Usage

- `LiveCli` stores the prompt as `system_prompt: Vec<String>` — computed once at construction time.
- On every `build_runtime()` call (new turns, session switches, model changes, compaction, etc.), the same `system_prompt.clone()` is passed to `ConversationRuntime::new_with_features()`.
- The `ConversationRuntime` stores it as `self.system_prompt: Vec<String>`.
- On each turn iteration, the runtime constructs `ApiRequest { system_prompt: self.system_prompt.clone(), messages: self.session.messages.clone() }`.
- In `AnthropicRuntimeClient::stream()`, the sections are joined: `system: (!request.system_prompt.is_empty()).then(|| request.system_prompt.join("\n\n"))`.

### 6. `claw system-prompt` Subcommand

A standalone `PrintSystemPrompt` CLI action calls `print_system_prompt()` which invokes `load_system_prompt()` directly and prints the joined result (text or JSON with sections array).

## Prompt Content

### Static Sections (before dynamic boundary)

**Intro section:**
- Identifies the agent as "an interactive agent that helps users with software engineering tasks"
- Warning against generating/guessing URLs unless for programming help
- Permits using URLs from user messages or local files

**System section:**
- All text outside tool use is displayed to the user
- Tools execute in a user-selected permission mode
- Tool results may include `<system-reminder>` or other tags
- Tool results may contain external data; flag suspected prompt injection
- Users may configure hooks that behave like feedback
- System may auto-compress prior messages

**Doing Tasks section:**
- Read relevant code before changing it; keep changes tightly scoped
- No speculative abstractions, compatibility shims, or unrelated cleanup
- Don't create files unless required
- Diagnose failures before switching tactics
- Avoid security vulnerabilities (command injection, XSS, SQL injection)
- Report outcomes faithfully; if verification wasn't run, say so

**Actions section:**
- Consider reversibility and blast radius
- Local reversible actions (file edits, tests) are fine
- Shared systems, publish state, data deletion need explicit authorization

### Dynamic Sections (after boundary)

**Environment context:**
- Model family: "Claude Opus 4.6" (hardcoded `FRONTIER_MODEL_NAME`)
- Working directory
- Date (build-time `DEFAULT_DATE`)
- Platform + OS version

**Project context:**
- Repeats date and cwd as bullets
- Count of discovered instruction files
- Git status snapshot (short branch format)
- Recent commits (last 5, with abbreviated hashes)
- Git diff snapshot (staged and unstaged, labeled)
- Full `GitContext::render()` output (branch, commits, staged files)

**Claude instructions:**
- Each instruction file rendered with header `## {filename} (scope: {parent_dir})`
- Content truncated per-file to 4,000 chars and globally to 12,000 chars total
- Truncation marker: `[truncated]`
- Files deduplicated by normalized content hash

**Runtime config:**
- Lists all loaded config entries: "Loaded {scope}: {path}"
- Renders full merged config JSON

## Integration Points

### Prompt -> Configuration (doc 01: `RuntimeConfig`, `ConfigLoader`)
- `load_system_prompt()` independently calls `ConfigLoader::default_for(&cwd).load()` to get a `RuntimeConfig` for rendering the config section. This is a separate load from the one in `build_runtime_plugin_state()` — the same config files are read and parsed twice per CLI invocation.

### Prompt -> Git Context (doc 01: bootstrap)
- `ProjectContext::discover_with_git()` gathers git state by shelling out to `git` commands. This runs during `build_system_prompt()` which is called in `LiveCli::new()` during step 7 of the bootstrap sequence (doc 01).

### Prompt -> ConversationRuntime (doc 01: `ConversationRuntime`)
- The `Vec<String>` prompt is stored in `ConversationRuntime.system_prompt` and cloned into every `ApiRequest`. The runtime does not modify or augment the prompt after construction.

### Prompt -> API Layer (doc 02: `MessageRequest`, `ProviderClient`)
- In `AnthropicRuntimeClient::stream()`, the system prompt sections are joined with `"\n\n"` and set as `MessageRequest.system: Option<String>`. This is the only place the sections become a single string.
- Tool definitions are added separately as `MessageRequest.tools` — they are **not** part of the system prompt string.

### Prompt -> Prompt Cache (doc 02: `PromptCache`, `TrackedPromptState`, `RequestFingerprints`)
- The `PromptCache` fingerprints the request via `RequestFingerprints::from_request()` which hashes `request.system` (the joined string), `request.model`, `request.tools`, and `request.messages` using FNV-1a.
- The `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` marker is **not** used by the cache — the entire system field is hashed as one blob. The boundary exists as a potential optimization point: a future implementation could split the system prompt at the boundary and cache the static prefix separately, reducing cache breaks caused by dynamic content changes (date, git status, etc.).
- Cache break detection compares fingerprint hashes between requests. Since the system prompt includes volatile content (git status, git diff, staged files), any git-state change between turns will change the `system_hash` and trigger an **expected** cache break.

### Prompt -> LiveCli (doc 01: `LiveCli`)
- The prompt is computed once in `LiveCli::new()` and reused for the entire session lifetime. It is not refreshed when git state changes between turns.

## Open Questions

1. **`SYSTEM_PROMPT_DYNAMIC_BOUNDARY` is unused downstream**: The constant is defined, exported via `runtime::lib.rs`, and injected as a section in `build()`, but no code outside `prompt.rs` references it (the CLI's `main.rs` does not import it). It appears intended for a future prompt-caching optimization that would split the system prompt into a cacheable static prefix and a volatile dynamic suffix. This would reduce Anthropic API cache breaks from git-state changes.

2. **`FRONTIER_MODEL_NAME` is hardcoded**: The model family name "Claude Opus 4.6" is a compile-time constant, not derived from the actual resolved model. If the user specifies `--model claude-sonnet-4-20250514`, the system prompt still claims "Model family: Claude Opus 4.6". This could confuse the model about its own identity or capabilities.

3. **System prompt is stale across turns**: The prompt is built once at `LiveCli::new()` and never refreshed. Git status, git diff, staged files, and instruction file content are all point-in-time snapshots from startup. Long-running REPL sessions will have increasingly stale context. The `reload_runtime_features()` method rebuilds the runtime but reuses `self.system_prompt.clone()`.

4. **Duplicate config loading**: As noted in doc 01, `load_system_prompt()` loads config independently from `build_runtime_plugin_state()`. The config section in the system prompt may theoretically differ from the config used to build the runtime if files are modified between the two loads (unlikely but architecturally unclean).

5. **OS version is always "unknown"**: Both `build_system_prompt()` and `load_system_prompt()` pass `"unknown"` as the OS version. The CLI's REPL banner separately detects and displays the OS version, but this information is not plumbed into the prompt builder.

6. **Instruction file budget (12K chars) may be too small**: The total instruction budget of 12,000 characters across all ancestor CLAUDE.md files could truncate meaningful project instructions in deep monorepo structures. There's no configuration knob to adjust this.

7. **Git context appears twice in the prompt**: `render_project_context()` renders both the `git_status`/`git_diff` snapshots (from `read_git_status`/`read_git_diff`) AND the full `GitContext::render()` output (from `GitContext::detect`). Both sources include recent commits — `render_project_context` shows them under "Recent commits (last 5):" from `git_context.recent_commits`, while `GitContext::render()` also shows them under "Recent commits:". This means recent commits may appear twice in the final prompt.

8. **No tool definitions in system prompt**: Tool definitions are passed separately in `MessageRequest.tools`, not embedded in the system prompt string. The system prompt references tools conceptually ("Tools are executed in a user-selected permission mode") but the actual tool schemas are a parallel channel. This is the correct Anthropic API pattern but worth noting for the next agent investigating the conversation loop.

## Key Files Read

| File | Absolute Path |
|------|---------------|
| prompt.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/prompt.rs` |
| git_context.rs | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/git_context.rs` |
| conversation.rs (partial — ApiRequest, system_prompt usage) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/conversation.rs` |
| main.rs (partial — build_system_prompt, AnthropicRuntimeClient::stream, LiveCli) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/rusty-claude-cli/src/main.rs` |
| build.rs (partial — BUILD_DATE) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/rusty-claude-cli/build.rs` |
| prompt_cache.rs (partial — TrackedPromptState, RequestFingerprints) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/api/src/prompt_cache.rs` |
| json.rs (partial — JsonValue::render) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/json.rs` |
| lib.rs (partial — re-exports) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/lib.rs` |
| config.rs (partial — as_json, RuntimeConfig) | `/home/mathipe/Prosjekter/Personal/claw-code/rust/crates/runtime/src/config.rs` |

### Files NOT read but referenced (for later agents)

- `runtime/src/conversation.rs` (full) — conversation turn loop, compaction, hook integration
- `runtime/src/compact.rs` — compaction logic, how system prompt interacts with context window management
- `runtime/src/session.rs` — `Session`, `ConversationMessage` types, how messages are stored alongside the prompt
- `tools/` crate — `GlobalToolRegistry`, `ToolDefinition`, how tool schemas are serialized into `MessageRequest.tools`
