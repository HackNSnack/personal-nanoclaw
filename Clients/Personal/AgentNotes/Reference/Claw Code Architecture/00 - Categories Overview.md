# Claw Code Architecture — Documentation Plan

> Documenting the architecture and logic of **claw-code**, a Rust rewrite of Claude Code (AI coding CLI).
> Repository: `~/Prosjekter/Personal/claw-code`

## Investigation Strategy

### Document Structure (each category doc)

Every category document follows this template so later investigations can consume prior output efficiently:

```
# [Category Name]
## Summary (2-3 sentences)
## Key Types & Structs (names, what they represent)
## Flow (step-by-step logic)
## Integration Points (how this connects to other categories)
## Open Questions (anything unresolved for later phases)
## Key Files Read (so later agents skip these)
```

Critical sections:
- **Key Types & Structs** — later phases reference by name, no re-reading source
- **Integration Points** — explicit cross-references to other category docs
- **Key Files Read** — prevents duplicate file reads across phases

### Phase Order & Context Chain

| Phase | Doc # | Category | Reads docs first | Parallel? |
|-------|-------|----------|-----------------|-----------|
| 1 | 01 | Configuration & Bootstrap | — | Yes (with 02) |
| 1 | 02 | API Client & Streaming | — | Yes (with 01) |
| 2 | 03 | Prompt Handling | 01, 02 | Yes (with 04) |
| 2 | 04 | Conversation Loop & Sessions | 01, 02, 03 | After 03 |
| 3 | 05 | Tool Execution | 02, 04 | First in phase |
| 3 | 06 | Permission & Policy Engine | 04, 05 | After 05 |
| 3 | 07 | Plugin & Hook System | 05 | After 05 |
| 4 | 08 | MCP | 05, 07 | Yes (with 09, 10) |
| 4 | 09 | Sub-agents & Task System | 04, 05 | Yes (with 08, 10) |
| 4 | 10 | Slash Commands | 01, 04 | Yes (with 08, 09) |
| 5 | 12 | UI & Rendering | 04 | Yes |
| 5 | 13 | Error Recovery & Remediation | 02, 04, 05 | Yes |

### Deferred Categories
| Doc # | Category | Prerequisite docs | Notes |
|-------|----------|-------------------|-------|
| 11 | Git & File Operations | 05 | Can be picked up later independently |
| 14 | Telemetry & Analytics | 01 | Can be picked up later independently |

### Workflow per category
1. Agent reads prerequisite docs from Obsidian (context loading)
2. Agent reads the source files for this category
3. Agent writes the doc to Obsidian in the standard structure
4. Human verifies before moving to next phase

---

## Categories

### 1. Prompt Handling
How system prompts are assembled, model instructions injected, and context provided to the LLM.
- Key files: `runtime/src/prompt.rs` (`SystemPromptBuilder`, `FRONTIER_MODEL_NAME`)

### 2. UI / Rendering
Terminal rendering, user input handling, output formatting (markdown, syntax highlighting, streaming).
- Key files: `rusty-claude-cli/src/render.rs`, `input.rs`, crossterm/syntect/pulldown-cmark usage

### 3. Sub-agents / Task System
Task spawning, worker lifecycle, task registry, team/cron orchestration.
- Key files: `runtime/src/task_registry.rs`, `worker_boot.rs`, `team_cron_registry.rs`

### 4. Conversation Loop & Session Management
The turn loop, message compaction, session persistence, and resume capability.
- Key files: `runtime/src/conversation.rs`, `session.rs`, `session_control.rs`, `compact.rs`

### 5. Tool Execution
How tools are registered, dispatched, and executed; the tool manifest pattern.
- Key files: `tools/src/lib.rs` (9,686 LOC)

### 6. API Client & Streaming
Provider abstraction (Anthropic/OpenAI), SSE streaming, prompt caching, auth resolution.
- Key files: `api/` crate — `client.rs`, `sse.rs`, `prompt_cache.rs`, `providers/`

### 7. Permission & Policy Engine
Permission evaluation, trust resolution, policy enforcement, sandboxing.
- Key files: `runtime/src/permissions.rs`, `permission_enforcer.rs`, `policy_engine.rs`, `sandbox.rs`, `trust_resolver.rs`

### 8. MCP (Model Context Protocol)
Client/server lifecycle, stdio transport, tool bridging — 6 modules.
- Key files: `runtime/src/mcp.rs`, `mcp_client.rs`, `mcp_server.rs`, `mcp_stdio.rs`, `mcp_lifecycle_hardened.rs`, `mcp_tool_bridge.rs`

### 9. Plugin & Hook System
Plugin loading, hook events (pre/post tool use), bundled vs external plugins.
- Key files: `plugins/` crate — `lib.rs`, `hooks.rs`

### 10. Slash Commands
Command registry, dispatch, skill integration.
- Key files: `commands/` crate — `lib.rs`

### 11. Git & File Operations *(deferred)*
Git context gathering, branch locking, stale detection, file ops with safety guards.
- Key files: `runtime/src/git_context.rs`, `file_ops.rs`, `branch_lock.rs`, `stale_base.rs`, `stale_branch.rs`

### 12. Error Recovery & Remediation
Recovery recipes, error classification, structured hints.
- Key files: `runtime/src/recovery_recipes.rs`, plus recent issues #156/#157

### 13. Telemetry & Analytics *(deferred)*
Event tracking, session tracing, client identity.
- Key files: `telemetry/` crate — `lib.rs`

### 14. Configuration & Bootstrap
Config loading/validation, initialization sequence, CLI arg parsing.
- Key files: `runtime/src/config.rs`, `config_validate.rs`, `bootstrap.rs`, `rusty-claude-cli/src/init.rs`

## Repo Stats
- **Total Rust LOC:** ~48,599
- **Workspace crates:** 9
- **Binary:** `claw`

## Status
- [x] Categories defined
- [x] Investigation plan & context chain defined
- [x] Phase 1: Config & Bootstrap + API Client
- [x] Phase 2: Prompt Handling + Conversation Loop
- [x] Phase 3: Tool Execution + Permissions + Plugins
- [x] Phase 4: MCP + Sub-agents + Slash Commands
- [x] Phase 5 (partial): UI & Rendering + Error Recovery
- [ ] **Deferred:** 11 — Git & File Operations (prerequisite: doc 05)
- [ ] **Deferred:** 14 — Telemetry & Analytics (prerequisite: doc 01)
