# 09 — System Prompt & Context Files

## Summary

The system prompt is assembled by `buildSystemPrompt()` (~170 LOC) from: a base template, active tool snippets, guidelines, context files (AGENTS.md), skills, and date/cwd. Context files are loaded from the filesystem walking up from cwd. Extensions can override or append to the system prompt via the `before_agent_start` event. The prompt is rebuilt before every agent turn.

## Key Types & Interfaces

| Type | Description |
|---|---|
| `BuildSystemPromptOptions` | `{customPrompt?, selectedTools?, toolSnippets?, promptGuidelines?, appendSystemPrompt?, cwd, contextFiles?, skills?}` |
| `Skill` | `{name, description, content, location, modelInvocation}` (from doc 11) |

## Flow

### System Prompt Assembly

```
buildSystemPrompt(options):

  IF customPrompt provided (from SYSTEM.md or --system-prompt):
    1. Start with customPrompt
    2. Append appendSystemPrompt if any
    3. Append context files
    4. Append skills section (if read tool available)
    5. Append date + cwd
    → Return

  DEFAULT prompt:
    1. Base role: "You are an expert coding assistant operating inside pi..."
    2. Available tools: only tools with promptSnippet defined
       - Built-in: read, bash, edit, write (always have snippets)
       - Extension tools: only if promptSnippet is set
    3. Guidelines:
       a. File exploration: bash-only vs grep/find/ls available
       b. Extension promptGuidelines (from tool definitions)
       c. Always: "Be concise", "Show file paths clearly"
    4. Pi documentation pointers:
       - README, docs/, examples/ paths
       - Topic-specific doc references
    5. Append appendSystemPrompt (from APPEND_SYSTEM.md or --append-system-prompt)
    6. Context files section (if any)
    7. Skills section (if read tool available and skills exist)
    8. Date + cwd
```

### Context File Loading

Context files are discovered by `ResourceLoader` (not in system-prompt.ts):

```
Discovery order:
1. ~/.pi/agent/AGENTS.md (global)
2. Walk UP from cwd, checking each directory for:
   - AGENTS.md
   - CLAUDE.md (compatibility)
3. cwd/AGENTS.md
4. cwd/.pi/AGENTS.md

All found files are concatenated.
Disable with: --no-context-files / -nc
```

### System Prompt Override

| File | Effect |
|---|---|
| `.pi/SYSTEM.md` or `~/.pi/agent/SYSTEM.md` | Replaces the entire default prompt |
| `.pi/APPEND_SYSTEM.md` or `~/.pi/agent/APPEND_SYSTEM.md` | Appends to the default prompt |
| `--system-prompt <text>` | Replaces the entire prompt (CLI) |
| `--append-system-prompt <text>` | Appends (CLI) |

### Extension System Prompt Modification

```
before_agent_start event:
  handler receives: {prompt, images?, systemPrompt, systemPromptOptions}
  handler can return: {systemPrompt: newPrompt}
  Multiple extensions chain: each sees the previous modification
```

### Per-Turn Rebuild

The system prompt is rebuilt before every agent turn (not cached across turns). This means:
- Context files are read once at startup but persist
- Tool snippets reflect the current active tool set
- Extension modifications apply per-turn

## Default System Prompt Structure

```
You are an expert coding assistant operating inside pi, a coding agent harness.
You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
- read: Read files and images
- bash: Execute shell commands
- edit: Edit files with surgical replacements
- write: Write new files
- [extension tools with promptSnippet]

Guidelines:
- Prefer grep/find/ls tools over bash for file exploration
- [extension promptGuidelines]
- Be concise in your responses
- Show file paths clearly when working with files

Pi documentation (read only when asked about pi):
- Main documentation: /path/to/README.md
- Additional docs: /path/to/docs/
- Examples: /path/to/examples/

[APPEND_SYSTEM.md content]

# Project Context
[AGENTS.md contents]

# Skills
[Available skills list]

Current date: 2026-07-20
Current working directory: /home/user/project
```

## Integration Points

| Connects to | How |
|---|---|
| **Agent Session (doc 04)** | Session calls `buildSystemPrompt()` before each turn |
| **Extension System (doc 06)** | `before_agent_start` event allows system prompt modification |
| **Tool System (doc 05)** | Tool `promptSnippet` and `promptGuidelines` injected |
| **Skills (doc 11)** | Skills section appended when available |
| **Bootstrap (doc 01)** | `--system-prompt`, `--append-system-prompt` CLI flags |

## Extension Relevance

- **Per-turn prompt modification**: Use `before_agent_start` to inject context dynamically.
- **Tool visibility**: Only tools with `promptSnippet` appear in "Available tools". Set this on custom tools for LLM awareness.
- **Guidelines injection**: Set `promptGuidelines` on tool definitions for behavioral guidance.
- **Custom system prompt**: Use `.pi/SYSTEM.md` for project-specific prompts. Or use `before_agent_start` for dynamic replacement.
- **Inspecting the prompt**: `ctx.getSystemPrompt()` returns the current effective prompt. `event.systemPromptOptions` in `before_agent_start` shows what was loaded.

## Open Questions

1. **Prompt size**: With many context files + skills + extensions, the prompt can grow large. No built-in size limit or warning.
2. **Context file caching**: Files are read once during resource loading but not watched for changes during a session. `/reload` is needed for changes.
3. **CLAUDE.md compatibility**: How long will CLAUDE.md support be maintained?

## Key Files Read

| File | Lines | Purpose |
|---|---|---|
| `coding-agent/src/core/system-prompt.ts` | 172 | System prompt assembly |
| `coding-agent/src/core/resource-loader.ts` | ~500 | Context file discovery (partial) |
