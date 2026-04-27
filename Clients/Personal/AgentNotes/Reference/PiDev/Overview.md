---
tags: [pidev, ai-tools, terminal, configuration]
type: reference
status: in-progress
created: 2026-04-21
---

# Pi.dev - Overview

Minimal terminal coding agent built by Mario Zechner, now owned by Earendil Inc. (Armin Ronacher - Flask/Ruff creator).

## Philosophy

**"Primitives, not features"** - Ships with 4 core tools, extend everything else yourself.

- Minimal system prompt (~60KB vs Claude Code's heavier footprint)
- TypeScript-based extensibility
- MIT licensed, open source
- Described as "the Vim of AI coding agents"

## Core Tools

| Tool | Purpose |
|------|---------|
| `read` | Access files, images, understand context |
| `write` | Create new files, generate boilerplate |
| `edit` | Surgical text replacement |
| `bash` | Execute commands, run tests, manage dependencies |

## Key Capabilities

### Writing From Scratch
✅ Fully capable of greenfield development
- Use `bash` to create directory structures, init package managers
- Use `write` to generate all project files
- Use `edit` for modifications
- Session branching (`/fork`, `/tree`) for exploring alternatives

### Markdown Rendering
✅ Built-in via `pi-tui` library
- Syntax-highlighted code blocks
- Inline formatting (bold, italic, links)
- Headers, lists, tables
- **Flicker-free streaming** with synchronized output
- Per-message caching (only active message re-renders)

### Extensibility
- TypeScript extensions (`~/.pi/agent/extensions/`)
- Skills (Agent Skills standard)
- Prompt templates with variable substitution
- Custom tools, slash commands, event hooks (25+ lifecycle events)

## Configuration Structure

```
~/.pi/agent/
├── settings.json          # Global config
├── models.json            # Custom model definitions
├── keybindings.json       # Keyboard shortcuts
├── AGENTS.md              # Global context instructions
├── SYSTEM.md              # System prompt override
├── extensions/            # Custom TypeScript modules
├── skills/                # Agent Skills packages
├── prompts/               # Reusable markdown templates
└── themes/                # UI customization

.pi/                       # Project-level overrides
├── settings.json
├── AGENTS.md
└── extensions/
```

## Model Support

15+ LLM providers:
- Anthropic, OpenAI, Google Gemini
- Azure OpenAI, AWS Bedrock, Vertex AI
- Mistral, Groq, Cerebras, xAI
- OpenRouter, Ollama (local)

## vs Claude Code

| Claude Code | Pi |
|-------------|-----|
| Full-featured, autonomous | Minimal core, extend as needed |
| MCP, sub-agents, plan mode built-in | Add via extensions |
| Optimized for Claude models | Model-agnostic harness |
| Heavy system prompt | ~60KB footprint |

## Installation

```bash
npm install -g @mariozechner/pi-coding-agent
```

## Resources

- [Official Site](https://pi.dev/)
- [GitHub - badlogic/pi-mono](https://github.com/badlogic/pi-mono)
- [npm Package](https://www.npmjs.com/package/@mariozechner/pi-coding-agent)

## Related Notes

- [[Clients/Personal/AgentNotes/Reference/PiDev/Configuration]]
- [[PiDev/Extensions]]
