# Pi.dev Architecture — Documentation Plan

> Documenting the architecture and internals of **pi-mono**, the TypeScript monorepo behind the `pi` coding agent CLI.
> Repository: `~/.pi/pi-mono` (GitHub: `badlogic/pi-mono`)
> Version: v0.68.1

## Document Structure (per category)

Every category document follows this template:

```
# [Category Name]
## Summary (2-3 sentences)
## Key Types & Interfaces
## Flow (step-by-step logic)
## Integration Points
## Extension Relevance (what extension authors need to know)
## Open Questions
## Key Files Read
```

Critical sections:
- **Key Types & Interfaces** — later phases reference by name, no re-reading source
- **Integration Points** — explicit cross-references to other category docs
- **Extension Relevance** — distilled guidance for extension developers
- **Key Files Read** — prevents duplicate file reads across phases

## Monorepo Package Overview

| Package | npm Name | LOC | Purpose |
|---|---|---|---|
| `agent` | `@earendil-works/pi-agent-core` | ~1,900 | Low-level agent loop, types, event protocol |
| `ai` | `@earendil-works/pi-ai` | ~28,400 | LLM providers, streaming, models, OAuth |
| `coding-agent` | `@earendil-works/pi-coding-agent` | ~43,400 | CLI, session mgmt, extensions, tools, modes, UI |
| `tui` | `@earendil-works/pi-tui` | ~11,000 | Terminal UI components, keyboard handling |
| `mom` | `@earendil-works/pi-mom` | ~4,000 | Internal tooling |
| `pods` | `@earendil-works/pi` | ~1,800 | Meta-package / launcher |
| `web-ui` | `@earendil-works/pi-web-ui` | ~varies | Web UI (not investigated) |

**Total TypeScript LOC:** ~90,500

## Categories

### 01. Monorepo Structure & Bootstrap
Package layout, CLI entry point, argument parsing, startup sequence.
- Key files: `coding-agent/src/main.ts`, `coding-agent/src/cli/args.ts`, `coding-agent/src/config.ts`

### 02. AI Provider Layer (`pi-ai`)
Model definitions, streaming protocol, provider implementations, OAuth.
- Key files: `ai/src/types.ts`, `ai/src/stream.ts`, `ai/src/models.ts`, `ai/src/providers/`

### 03. Agent Core (`pi-agent-core`)
The low-level agent loop, tool execution, event protocol, message queuing.
- Key files: `agent/src/types.ts`, `agent/src/agent.ts`, `agent/src/agent-loop.ts`

### 04. Agent Session & Conversation Loop
High-level session abstraction, prompting, compaction triggers, model management.
- Key files: `coding-agent/src/core/agent-session.ts`, `coding-agent/src/core/agent-session-services.ts`

### 05. Tool System
Built-in tools (read, write, edit, bash, grep, find, ls), tool definition wrapper, file mutation queue.
- Key files: `coding-agent/src/core/tools/`

### 06. Extension System
Extension API, types, loader, runner, event lifecycle, tool/command/shortcut registration.
- Key files: `coding-agent/src/core/extensions/`

### 07. Session Management & Branching
JSONL persistence, tree navigation, forking, session switching.
- Key files: `coding-agent/src/core/session-manager.ts`

### 08. Compaction & Context Management
Compaction algorithm, cut points, branch summarization, context token estimation.
- Key files: `coding-agent/src/core/compaction/`

### 09. System Prompt & Context Files
Prompt assembly, AGENTS.md loading, tool snippet injection, context file discovery.
- Key files: `coding-agent/src/core/system-prompt.ts`, `coding-agent/src/core/resource-loader.ts`

### 10. Modes & UI Layer
Interactive mode (TUI), print mode, RPC mode, JSON event stream.
- Key files: `coding-agent/src/modes/`

### 11. Skills, Prompts & Resources
Skill discovery/invocation, prompt templates, theme system, resource loading.
- Key files: `coding-agent/src/core/skills.ts`, `coding-agent/src/core/prompt-templates.ts`, `coding-agent/src/core/resource-loader.ts`

### 12. Model Registry & Resolution
Model discovery, scoped models, CLI model resolution, provider registration.
- Key files: `coding-agent/src/core/model-registry.ts`, `coding-agent/src/core/model-resolver.ts`

## Status

- [x] Categories defined
- [x] 01 — Monorepo Structure & Bootstrap
- [x] 02 — AI Provider Layer
- [x] 03 — Agent Core
- [x] 04 — Agent Session & Conversation Loop
- [x] 05 — Tool System
- [x] 06 — Extension System
- [x] 07 — Session Management & Branching
- [x] 08 — Compaction & Context Management
- [x] 09 — System Prompt & Context Files
- [x] 10 — Modes & UI Layer
- [x] 11 — Skills, Prompts & Resources
- [x] 12 — Model Registry & Resolution

## Comparison with Claw Code

These docs mirror [[Clients/Personal/AgentNotes/Reference/Claw Code Architecture/00 - Categories Overview]] in structure. Key architectural differences:

| Aspect | Claw Code (Rust) | Pi (TypeScript) |
|---|---|---|
| **Language** | Rust, ~48K LOC | TypeScript, ~90K LOC |
| **Tool registration** | Tools declare `required_permission` in `ToolSpec` | No built-in permission; extensions hook `tool_call` event |
| **Extension model** | Plugin crate with hooks (Rust traits) | TypeScript modules loaded via `jiti`, full event bus |
| **Permission system** | Built-in `PermissionEnforcer` with deny/ask/allow | No built-in permissions — entirely via extensions |
| **Agent loop** | Generic `ConversationRuntime<C, T>` | `Agent` class with `AgentLoopConfig` callbacks |
| **Provider dispatch** | `detect_provider_kind` at runtime | `Model.api` field selects provider at model registration |
| **Session format** | Binary + JSON | JSONL with tree structure |
| **Sandbox** | OS-level namespaces (`unshare`) | None built-in |

## Related

- [[Clients/Personal/AgentNotes/Reference/PiDev/Overview]] — High-level overview
- [[Clients/Personal/AgentNotes/Reference/PiDev/Documentation/Pi Documentation Index - LLM Reference]] — Doc file index
- [[Clients/Personal/AgentNotes/Reference/PiDev/Documentation/Pi Coding Agent - Full Documentation]] — Full feature docs
- [[Clients/Personal/AgentNotes/Reference/Claw Code Architecture/00 - Categories Overview]] — Equivalent Claw Code docs
