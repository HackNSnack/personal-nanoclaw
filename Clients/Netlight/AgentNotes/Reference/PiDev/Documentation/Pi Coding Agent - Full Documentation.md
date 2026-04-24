# Pi Coding Agent - Full Documentation

> Source: `/home/mathipe/.pi/pi-mono/packages/coding-agent/`
> Version: v0.68.1
> Last synced: 2026-04-22

---

## Overview

Pi is a minimal terminal coding harness built by Mario Zechner. It's aggressively extensible — features like sub-agents, plan mode, permission popups, and to-dos are deliberately excluded from the core and left to extensions/packages. Pi runs in four modes: interactive, print/JSON, RPC, and SDK.

**Core tools:** `read`, `write`, `edit`, `bash` (default). Additional: `grep`, `find`, `ls`.

**Package:** `@mariozechner/pi-coding-agent` (npm)

---

## Quick Start

```bash
npm install -g @mariozechner/pi-coding-agent
export ANTHROPIC_API_KEY=sk-ant-...
pi
```

Or authenticate via subscription: `pi` then `/login`.

---

## Providers & Models

### Subscriptions (OAuth via `/login`)
- Anthropic Claude Pro/Max
- OpenAI ChatGPT Plus/Pro (Codex)
- GitHub Copilot
- Google Gemini CLI
- Google Antigravity

### API Keys (env vars or auth file)
Anthropic, OpenAI, Azure OpenAI, Google Gemini, Google Vertex, Amazon Bedrock, Mistral, Groq, Cerebras, xAI, OpenRouter, Vercel AI Gateway, ZAI, OpenCode Zen, OpenCode Go, Hugging Face, Fireworks, Kimi For Coding, MiniMax

### Auth Resolution Order
1. `--api-key` CLI flag
2. Runtime API key (set via SDK)
3. Environment variable (e.g., `ANTHROPIC_API_KEY`)
4. Auth file (`~/.pi/agent/auth.json`)
5. OAuth token (from `/login`)

### Custom Models (`~/.pi/agent/models.json`)
Add providers speaking OpenAI, Anthropic, or Google APIs. Supports:
- Custom base URLs and headers
- Per-model overrides
- OpenAI compatibility layer (for OpenRouter, Vercel AI Gateway, etc.)
- Value resolution: `env:VAR_NAME`, `file:/path`, `cmd:command`

### Custom Providers (via extensions)
For non-standard APIs or OAuth flows, register providers via `pi.registerProvider()`. Supports custom streaming APIs with content blocks, tool calls, usage tracking.

---

## Interactive Mode

### Interface Layout
- **Startup header** — shortcuts, loaded AGENTS.md files, prompts, skills, extensions
- **Messages** — user/assistant messages, tool calls/results, notifications
- **Editor** — input area, border color = thinking level
- **Footer** — cwd, session name, tokens, cost, context usage, model

### Editor Features
| Feature | How |
|---------|-----|
| File reference | `@` to fuzzy-search |
| Path completion | Tab |
| Multi-line | Shift+Enter |
| Images | Ctrl+V paste, or drag |
| Bash commands | `!cmd` (send to LLM), `!!cmd` (run only) |

### Commands
`/login`, `/logout`, `/model`, `/scoped-models`, `/settings`, `/resume`, `/new`, `/name`, `/session`, `/tree`, `/fork`, `/clone`, `/compact`, `/copy`, `/export`, `/share`, `/reload`, `/hotkeys`, `/changelog`, `/quit`

### Key Shortcuts
| Key | Action |
|-----|--------|
| Ctrl+C | Clear / Quit (twice) |
| Escape | Cancel / `/tree` (twice) |
| Ctrl+L | Model selector |
| Ctrl+P / Shift+Ctrl+P | Cycle models |
| Shift+Tab | Cycle thinking level |
| Ctrl+O | Collapse/expand tools |
| Ctrl+T | Collapse/expand thinking |

### Message Queue
- **Enter** — steering message (after current tool calls)
- **Alt+Enter** — follow-up (after agent finishes)
- **Escape** — abort, restore queued
- **Alt+Up** — retrieve queued to editor

Settings: `steeringMode`, `followUpMode` (`"one-at-a-time"` | `"all"`), `transport` (`"sse"` | `"websocket"` | `"auto"`)

---

## Sessions

JSONL files with tree structure. Each entry has `id` and `parentId` for in-place branching.

### Storage
`~/.pi/agent/sessions/` organized by working directory.

### CLI Flags
```bash
pi -c                  # Continue recent
pi -r                  # Browse sessions
pi --no-session        # Ephemeral
pi --session <path|id> # Specific session
pi --fork <path|id>    # Fork session
```

### Branching
- `/tree` — navigate session tree in-place, switch branches
- `/fork` — new session from previous user message
- `/clone` — duplicate current branch into new session
- Filter modes in tree: default → no-tools → user-only → labeled-only → all

### Session File Format
Entry types: `SessionHeader`, `SessionMessageEntry`, `ModelChangeEntry`, `ThinkingLevelChangeEntry`, `CompactionEntry`, `BranchSummaryEntry`, `CustomEntry`, `CustomMessageEntry`, `LabelEntry`, `SessionInfoEntry`

### SessionManager API
- Static: `create(cwd)`, `inMemory()`, `listSessions(cwd)`, `findSession(cwd, id)`
- Instance: `getActiveLeafId()`, `setActiveLeafId()`, `getBranch(leafId?)`, `getChildren(entryId)`, `appendEntry(entry)`, `getEntry(id)`, `getSessionFilePath()`, `getSessionId()`

---

## Compaction

Summarizes older messages when context grows large.

### Triggers
- **Context overflow** — recovers and retries
- **Proactive** — when approaching limit (configurable threshold)
- **Manual** — `/compact [instructions]`

### How It Works
1. Finds a cut point (after a complete tool-use turn)
2. Sends everything before the cut point to the model for summarization
3. Replaces summarized messages with a `CompactionEntry`
4. Recent messages after cut point are preserved

### Settings
- `autoCompact`: `true`/`false`
- `compactThreshold`: 0.0-1.0 (default 0.8)
- `compactMessageRetention`: number of recent messages to keep
- `branchSummary`: enable/disable branch summarization

### Custom Compaction (via extensions)
Hook into `session_before_compact` event to provide custom summarization logic.

---

## Settings

### Locations
| Location | Scope |
|----------|-------|
| `~/.pi/agent/settings.json` | Global |
| `.pi/settings.json` | Project (overrides global) |

### Key Settings
- **Model & Thinking**: `model`, `thinkingLevel` (off/minimal/low/medium/high/xhigh)
- **UI**: `theme`, `verbose`, `showToolOutput`
- **Compaction**: `autoCompact`, `compactThreshold`, `compactMessageRetention`
- **Branch Summary**: `branchSummary`
- **Retry**: `maxRetries`, `retryDelay`
- **Message Delivery**: `steeringMode`, `followUpMode`, `transport`
- **Terminal**: `imageSupport`, `sixelSupport`
- **Shell**: `shellCommandPrefix`, `shellPath`
- **Sessions**: `sessionDir`
- **Model Cycling**: `scopedModels`
- **Resources**: packages, extensions, skills, prompts, themes paths and filtering

---

## Context Files

Pi loads `AGENTS.md` (or `CLAUDE.md`) at startup:
- `~/.pi/agent/AGENTS.md` (global)
- Parent directories (walking up)
- Current directory

All matching files concatenated. Disable with `--no-context-files` / `-nc`.

### System Prompt Override
- `.pi/SYSTEM.md` or `~/.pi/agent/SYSTEM.md` — replaces default
- `APPEND_SYSTEM.md` — appends without replacing

---

## Extensions

TypeScript modules that extend pi. The most powerful customization mechanism.

### Locations
- `~/.pi/agent/extensions/` (global)
- `.pi/extensions/` (project)
- Pi packages

### Structure
```typescript
export default function (pi: ExtensionAPI) {
  // Can be async
  pi.registerTool({ ... });
  pi.registerCommand("name", { ... });
  pi.on("event_name", async (event, ctx) => { ... });
}
```

### Available Imports
```typescript
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text, Box, Container } from "@mariozechner/pi-tui";
```

### Events (Lifecycle)

#### Resource Events
- `resources_discover` — add dynamic skills/prompts/themes

#### Session Events
- `session_start` — session loaded/created
- `session_shutdown` — session ending
- `session_before_compact` — before compaction (can customize)
- `session_before_switch` / `session_switch` — branch switching
- `session_before_fork` / `session_fork` — forking
- `session_before_tree` / `session_tree` — tree navigation

#### Agent Events
- `before_agent_start` — before each agent turn (can modify system prompt via `systemPromptAppend` or `systemPromptOptions`)
- `agent_start` — agent turn started
- `agent_end` — agent turn completed

#### Tool Events
- `tool_call` — before tool execution (can block, modify args, redirect)
- `tool_result` — after tool execution (can modify result)

#### Model Events
- `model_select` — model changed

#### User Events
- `user_bash` — user ran `!command` (can intercept for interactive shells)
- `input` — user submitted text (can transform)
- `turn_start` / `turn_end` — user turn boundaries

#### Provider Events
- `before_provider_request` — inspect/modify LLM request payload
- `after_provider_response` — inspect response headers

### ExtensionAPI Methods
- `registerTool(def)` — custom tool
- `registerCommand(name, def)` — slash command
- `registerShortcut(key, handler)` — keyboard shortcut
- `registerFlag(name, def)` — CLI flag
- `registerMessageRenderer(type, fn)` — custom message rendering
- `registerProvider(config)` — custom LLM provider
- `on(event, handler)` — event listener
- `sendMessage(msg)` — inject message into conversation
- `sendUserMessage(text)` — inject as user message
- `appendEntry(entry)` — write to session
- `compact(instructions?)` — trigger compaction
- `shutdown()` — graceful shutdown
- `events` — inter-extension event bus

### ExtensionContext (ctx)
- `ui` — full UI API (dialogs, widgets, status, footer, editor, themes, overlays)
- `sessionManager` — session access
- `exec(cmd)` — run shell commands
- `hasUI` — check if UI available (non-interactive modes)
- `reload()` — hot-reload extensions/skills/prompts
- `getSystemPrompt()` — current system prompt

### Custom Tools
```typescript
pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "What it does",
  parameters: Type.Object({ ... }),
  async execute(toolCallId, params, onUpdate, ctx, signal) {
    return { content: [{ type: "text", text: "result" }], details: {} };
  },
  renderCall(args, theme, context) { ... },
  renderResult(result, options, theme, context) { ... },
});
```

**Key patterns:**
- Use `StringEnum` for string params (Google compatibility)
- Store state in `details` for session persistence/forking
- Reconstruct state from session on `session_start`
- Override built-in tools by registering with same name
- `renderShell: "self"` for full control over rendering

### Custom UI
- `ctx.ui.select()`, `ctx.ui.confirm()`, `ctx.ui.input()`, `ctx.ui.editor()`
- `ctx.ui.notify(msg, level)` — non-blocking notification
- `ctx.ui.setStatus(id, text)` — footer status
- `ctx.ui.setWidget(id, content, options)` — above/below editor
- `ctx.ui.setFooter(fn)` / `ctx.ui.setHeader(fn)` — replace footer/header
- `ctx.ui.setEditorComponent(fn)` — custom editor (vim, emacs)
- `ctx.ui.custom(fn)` — fully custom component replacing editor
- `ctx.ui.custom(fn, { overlay: true })` — overlay mode
- Timed dialogs with `{ timeout: ms }` or `{ signal: AbortSignal }`

### Error Handling
- Extension errors: logged, agent continues
- `tool_call` errors: block the tool (fail-safe)
- Tool `execute` errors: throw → caught → reported to LLM with `isError: true`

### Mode Behavior
| Mode | UI | Notes |
|------|----|-------|
| Interactive | Full TUI | Normal |
| RPC | JSON protocol | Host handles UI |
| JSON | No-op | Event stream |
| Print (`-p`) | No-op | Extensions run, can't prompt |

---

## Skills

On-demand capability packages following Agent Skills standard.

### Locations
- `~/.pi/agent/skills/` (global)
- `~/.agents/skills/` (global, shared standard)
- `.pi/skills/` (project)
- `.agents/skills/` (project + parent dirs)
- Pi packages

### Structure
```markdown
---
name: my-skill
description: What it does
---
# Skill content
Instructions for the model...
```

### Frontmatter Fields
- `name` (required) — lowercase, hyphens, 1-50 chars
- `description` (required) — one line
- `model-invocation` — `"auto"` (default) or `"disabled"`

### Invocation
- `/skill:name` — explicit
- Automatic — model can invoke if `model-invocation: auto`

---

## Prompt Templates

Reusable markdown prompts.

### Locations
- `~/.pi/agent/prompts/` (global)
- `.pi/prompts/` (project)
- Pi packages

### Format
```markdown
---
description: What this template does
argument-hint: <file> [options]
---
Template content with $1, $2 for positional args.
Use $@ for all args, $2.. for slicing.
```

### Usage
Type `/templatename args` in editor.

---

## TUI Components

For building custom UI in extensions.

### Component Interface
```typescript
interface Component {
  render(width: number): string[];
  get height(): number;
}
```

### Focusable Interface (for keyboard input)
```typescript
interface Focusable extends Component {
  onKey(key: string): boolean;
  onResize?(): void;
}
```

### Built-in Components
- `Text` — styled text
- `Box` — bordered container
- `Container` — vertical layout
- `Spacer` — empty lines
- `Markdown` — rendered markdown
- `Image` — terminal images

### Keyboard Input
```typescript
import { matchesKey } from "@mariozechner/pi-tui";
if (matchesKey(key, "ctrl+a")) { ... }
```

### Overlays
```typescript
ctx.ui.custom(fn, {
  overlay: true,
  overlayOptions: { anchor: "center", width: "50%", margin: 2 }
});
```

---

## Themes

### Locations
- `~/.pi/agent/themes/` (global)
- `.pi/themes/` (project)
- Pi packages

### Built-in
`dark`, `light` — hot-reload on file change.

### Format
JSON with `vars` and `colors` sections. 51 color tokens covering: core UI, backgrounds, markdown, tool diffs, syntax highlighting, thinking level borders, bash mode, HTML export.

### Color Values
- Hex: `"#ff0000"`
- 256-color: `"196"`
- Variable reference: `"$varName"`
- Default/inherit: `"default"`

---

## Pi Packages

Bundle extensions, skills, prompts, themes for sharing.

### Install/Manage
```bash
pi install npm:@foo/pi-tools
pi install git:github.com/user/repo
pi remove npm:@foo/pi-tools
pi list
pi update
pi config  # enable/disable resources
```

### Create
Add `pi` key to `package.json`:
```json
{
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

### Storage
- Global: `~/.pi/agent/git/` (git) or global npm
- Project-local: `.pi/git/`, `.pi/npm/` (with `-l` flag)

---

## SDK (Programmatic Usage)

```typescript
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from "@mariozechner/pi-coding-agent";

const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage, modelRegistry,
});

session.subscribe((event) => { ... });
await session.prompt("Hello");
```

### Key Types
- `createAgentSession(options)` — create session
- `createAgentSessionRuntime()` — multi-session runtime
- `AgentSession` — prompt, subscribe, abort
- `SessionManager` — persistence
- `DefaultResourceLoader` — extensions, skills, prompts, themes
- `SettingsManager` — settings overrides

### Events
`message_update`, `tool_execution_start`, `tool_execution_end`, `agent_end`, `compaction_start`, `compaction_end`, `retry`

---

## RPC Mode

Headless operation via JSON protocol over stdin/stdout.

```bash
pi --mode rpc
```

**Framing:** Strict LF-delimited JSONL. Do NOT use generic line readers.

### Commands
`prompt`, `steer`, `follow_up`, `abort`, `state`, `model`, `thinking`, `queue_mode`, `compact`, `retry`, `bash`, `session`, `commands`

### Extension UI Protocol
Dialogs (`select`, `confirm`, `input`, `editor`) are forwarded as `extension_ui_request` events. Host responds with `extension_ui_response`.

---

## JSON Mode

```bash
pi --mode json
```

Outputs all events as JSON lines to stdout. Event types mirror `AgentSessionEvent` and `AgentEvent`.

---

## CLI Reference

```bash
pi [options] [@files...] [messages...]
```

### Key Flags
- `-p` / `--print` — print mode
- `-c` / `--continue` — continue session
- `-r` / `--resume` — browse sessions
- `--model <pattern>` — model (supports `provider/id:thinking`)
- `--thinking <level>` — off/minimal/low/medium/high/xhigh
- `--tools <list>` — enable specific tools
- `-e` / `--extension <source>` — load extension
- `--no-extensions`, `--no-skills`, `--no-context-files` — disable discovery
- `--system-prompt <text>` — replace prompt
- `--append-system-prompt <text>` — append to prompt

### Environment Variables
| Variable | Description |
|----------|-------------|
| `PI_CODING_AGENT_DIR` | Override config dir (default: `~/.pi/agent`) |
| `PI_PACKAGE_DIR` | Override package dir |
| `PI_SKIP_VERSION_CHECK` | Skip version check |
| `PI_TELEMETRY` | Enable/disable telemetry |
| `PI_CACHE_RETENTION` | `"long"` for extended cache |
| `VISUAL`, `EDITOR` | External editor for Ctrl+G |

---

## Extension Examples Catalog

### Tools
| Example | Description | Key APIs |
|---------|-------------|----------|
| `hello.ts` | Minimal tool | `registerTool` |
| `question.ts` | Tool with user interaction | `registerTool`, `ui.select` |
| `questionnaire.ts` | Multi-step wizard | `registerTool`, `ui.custom` |
| `todo.ts` | Stateful with persistence | `registerTool`, `appendEntry`, session events |
| `dynamic-tools.ts` | Register tools at runtime | `registerTool`, `session_start`, `registerCommand` |
| `tool-override.ts` | Override built-in read | `registerTool` (same name) |
| `truncated-tool.ts` | Output truncation | `registerTool`, `truncateHead` |
| `ssh.ts` | SSH remote execution | `registerFlag`, `on("user_bash")` |
| `subagent/` | Spawn sub-agents | `registerTool`, `exec` |

### Commands & UI
| Example | Description |
|---------|-------------|
| `pirate.ts` | System prompt per-turn |
| `preset.ts` | Saveable presets |
| `plan-mode/` | Read-only plan mode |
| `tools.ts` | Toggle tools on/off |
| `handoff.ts` | Cross-provider handoff |
| `qna.ts` | Q&A with custom UI |
| `status-line.ts` | Footer status |
| `modal-editor.ts` | Vim-style editor |
| `custom-footer.ts` | Replace footer |
| `doom-overlay/` | DOOM in overlay |
| `snake.ts` / `space-invaders.ts` | Games |

### Events & Gates
| Example | Description |
|---------|-------------|
| `permission-gate.ts` | Block dangerous commands |
| `protected-paths.ts` | Block writes to paths |
| `confirm-destructive.ts` | Confirm session changes |
| `dirty-repo-guard.ts` | Warn dirty repo |
| `input-transform.ts` | Transform user input |

### Git Integration
| Example | Description |
|---------|-------------|
| `git-checkpoint.ts` | Git stash on turns |
| `auto-commit-on-exit.ts` | Commit on shutdown |

### Custom Providers
| Example | Description |
|---------|-------------|
| `custom-provider-anthropic/` | Anthropic proxy with OAuth |
| `custom-provider-gitlab-duo/` | GitLab Duo integration |
| `custom-provider-qwen-cli/` | Qwen CLI with device flow |

---

## Subagent System (Extension Example)

### Agent Definitions (`~/.pi/agent/agents/*.md`)
```markdown
---
name: agent-name
description: What it does
tools: read, grep, find, ls
model: claude-haiku-4-5
---
System prompt here.
```

### Sample Agents
| Agent | Purpose | Model |
|-------|---------|-------|
| `scout` | Fast recon | Haiku |
| `planner` | Implementation plans | Sonnet |
| `reviewer` | Code review | Sonnet |
| `worker` | General-purpose | Sonnet |

### Workflow Prompts
| Prompt | Flow |
|--------|------|
| `/implement <query>` | scout → planner → worker |
| `/scout-and-plan <query>` | scout → planner |
| `/implement-and-review <query>` | worker → reviewer → worker |

### Modes
- Single: `{ agent, task }`
- Parallel: `{ tasks: [...] }` (max 8, 4 concurrent)
- Chain: `{ chain: [...] }` with `{previous}` placeholder
