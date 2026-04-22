# Pi Documentation Index — LLM Reference

> Use this file to quickly locate which documentation covers a given topic.
> All paths are relative to `/home/mathipe/.pi/pi-mono/packages/coding-agent/`

---

## Quick Lookup Table

| Topic | Primary Doc | Secondary Docs |
|-------|-------------|----------------|
| Getting started | `README.md` | — |
| Extension authoring | `docs/extensions.md` | `examples/extensions/README.md` |
| Custom tools | `docs/extensions.md` (§Custom Tools) | `examples/extensions/hello.ts`, `todo.ts` |
| Custom UI / TUI components | `docs/tui.md` | `docs/extensions.md` (§Custom UI) |
| Event hooks / lifecycle | `docs/extensions.md` (§Events) | — |
| Custom providers | `docs/custom-provider.md` | `docs/models.md`, `examples/extensions/custom-provider-*` |
| Models & model config | `docs/models.md` | `docs/providers.md` |
| Auth & providers | `docs/providers.md` | `README.md` (§Providers) |
| Settings reference | `docs/settings.md` | — |
| Keybindings | `docs/keybindings.md` | — |
| Themes | `docs/themes.md` | — |
| Skills | `docs/skills.md` | — |
| Prompt templates | `docs/prompt-templates.md` | — |
| Pi packages | `docs/packages.md` | `README.md` (§Pi Packages) |
| Sessions & session format | `docs/session.md` | `docs/tree.md` |
| Session tree / branching | `docs/tree.md` | `docs/session.md` |
| Compaction | `docs/compaction.md` | `docs/settings.md` |
| SDK / programmatic usage | `docs/sdk.md` | `examples/sdk/README.md` |
| RPC mode | `docs/rpc.md` | `docs/json.md` |
| JSON event stream | `docs/json.md` | — |
| Subagents | `examples/extensions/subagent/README.md` | `examples/extensions/subagent/agents/*.md` |
| Plan mode | `examples/extensions/plan-mode/README.md` | — |
| Terminal setup | `docs/terminal-setup.md` | `docs/tmux.md` |
| Windows | `docs/windows.md` | — |
| Android / Termux | `docs/termux.md` | — |
| tmux | `docs/tmux.md` | — |
| Shell aliases | `docs/shell-aliases.md` | — |
| Development / contributing | `docs/development.md` | `../../CONTRIBUTING.md` |
| Context files (AGENTS.md) | `README.md` (§Context Files) | — |
| System prompt override | `README.md` (§System Prompt) | `docs/extensions.md` (§before_agent_start) |
| CLI reference | `README.md` (§CLI Reference) | — |

---

## By Task: "I want to..."

### Set up pi for the first time
→ `README.md` (Quick Start, Providers & Models)
→ `docs/providers.md` (detailed auth setup)
→ `docs/terminal-setup.md` (if using Kitty/iTerm2/Ghostty/etc.)

### Write an extension
→ `docs/extensions.md` — the main reference (~2400 lines, covers everything)
→ `examples/extensions/README.md` — catalog of all example extensions
→ `docs/tui.md` — if building custom UI components

**Extension quick-start pattern:**
```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
export default function (pi: ExtensionAPI) { ... }
```

### Register a custom tool
→ `docs/extensions.md` §Custom Tools
→ `examples/extensions/hello.ts` (minimal), `todo.ts` (stateful), `question.ts` (with UI)

### Hook into events (tool calls, agent lifecycle, etc.)
→ `docs/extensions.md` §Events — lists all events:
  - Resource: `resources_discover`
  - Session: `session_start`, `session_shutdown`, `session_before_compact`, `session_before_switch`, `session_before_fork`, `session_before_tree`
  - Agent: `before_agent_start`, `agent_start`, `agent_end`
  - Tool: `tool_call`, `tool_result`
  - Model: `model_select`
  - User: `user_bash`, `input`, `turn_start`, `turn_end`
  - Provider: `before_provider_request`, `after_provider_response`

### Build custom UI (overlays, dialogs, editors)
→ `docs/tui.md` — Component/Focusable interfaces, built-in components, overlay API
→ `docs/extensions.md` §Custom UI — ctx.ui methods: select, confirm, input, editor, custom, widgets, status, footer

### Add a custom LLM provider
→ `docs/custom-provider.md` — registerProvider, OAuth, custom streaming
→ `docs/models.md` — models.json for standard API providers
→ `examples/extensions/custom-provider-anthropic/`, `custom-provider-gitlab-duo/`

### Configure models
→ `docs/models.md` — models.json format, provider config, OpenAI compatibility
→ `docs/providers.md` — auth methods per provider

### Customize keybindings
→ `docs/keybindings.md` — `~/.pi/agent/keybindings.json`, all action IDs

### Create a theme
→ `docs/themes.md` — JSON format, 51 color tokens, hot-reload

### Create a skill
→ `docs/skills.md` — SKILL.md format, frontmatter, locations

### Create a prompt template
→ `docs/prompt-templates.md` — format, arguments, locations

### Package and share extensions/skills
→ `docs/packages.md` — pi key in package.json, install/remove/update

### Use pi programmatically (SDK)
→ `docs/sdk.md` — createAgentSession, events, options
→ `examples/sdk/README.md` — 13 examples from minimal to full control

### Integrate pi via RPC
→ `docs/rpc.md` — protocol, commands, events, example clients (Python, Node.js)

### Understand session file format
→ `docs/session.md` — JSONL format, entry types, tree structure, SessionManager API

### Customize compaction behavior
→ `docs/compaction.md` — triggers, cut points, custom via extensions
→ `docs/settings.md` — compaction settings

### Set up subagents
→ `examples/extensions/subagent/README.md` — full subagent extension
→ Agent definitions: `examples/extensions/subagent/agents/scout.md`, `planner.md`, `reviewer.md`, `worker.md`
→ Workflow prompts: `examples/extensions/subagent/prompts/implement.md`, `scout-and-plan.md`, `implement-and-review.md`

### Set up plan mode
→ `examples/extensions/plan-mode/README.md` — read-only mode, bash allowlist, step tracking

### Debug extension issues
→ `docs/extensions.md` §Error Handling — extension errors logged, tool_call errors block
→ `docs/extensions.md` §Mode Behavior — check `ctx.hasUI` in non-interactive modes
→ `docs/development.md` — debug command, testing

---

## File Tree (docs only)

```
packages/coding-agent/
├── README.md                          # Main entry, overview, CLI reference
├── CHANGELOG.md                       # Version history
├── docs/
│   ├── compaction.md                  # Compaction internals
│   ├── custom-provider.md             # Custom LLM providers via extensions
│   ├── development.md                 # Dev setup, debugging, testing
│   ├── extensions.md                  # ★ MAIN EXTENSION DOCS (~2400 lines)
│   ├── json.md                        # JSON event stream mode
│   ├── keybindings.md                 # All keybindings + customization
│   ├── models.md                      # Custom models via models.json
│   ├── packages.md                    # Pi packages (npm/git)
│   ├── prompt-templates.md            # Prompt template format
│   ├── providers.md                   # Auth & provider setup
│   ├── rpc.md                         # RPC mode protocol
│   ├── sdk.md                         # SDK / programmatic usage
│   ├── session.md                     # Session file format
│   ├── settings.md                    # All settings reference
│   ├── shell-aliases.md               # Shell alias config
│   ├── skills.md                      # Skills format & discovery
│   ├── terminal-setup.md              # Terminal keyboard protocol
│   ├── termux.md                      # Android Termux setup
│   ├── themes.md                      # Theme format & colors
│   ├── tmux.md                        # tmux config
│   ├── tree.md                        # Session tree navigation
│   ├── tui.md                         # TUI component system
│   └── windows.md                     # Windows setup
├── examples/
│   ├── README.md                      # Examples overview
│   ├── extensions/
│   │   ├── README.md                  # ★ Full extension examples catalog
│   │   ├── plan-mode/README.md        # Plan mode extension docs
│   │   ├── doom-overlay/README.md     # DOOM overlay demo
│   │   └── subagent/
│   │       ├── README.md              # Subagent extension docs
│   │       ├── agents/*.md            # Agent definitions
│   │       └── prompts/*.md           # Workflow prompts
│   └── sdk/
│       └── README.md                  # SDK examples catalog
```

---

## Key Imports for Extension Development

```typescript
// Core extension types
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

// Custom editor base class
import { CustomEditor, keyHint, keyText, highlightCode, getLanguageFromPath } from "@mariozechner/pi-coding-agent";

// Tool parameter schemas
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai"; // Required for Google compatibility

// TUI components
import { Text, Box, Container, Spacer, Markdown, Image, matchesKey } from "@mariozechner/pi-tui";

// SDK
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager, SettingsManager, DefaultResourceLoader } from "@mariozechner/pi-coding-agent";
import { codingTools, readOnlyTools, readTool, bashTool, editTool, writeTool } from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
```
