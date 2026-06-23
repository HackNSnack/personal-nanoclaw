---
tags: [pi, debugging, system-prompt, extensions]
type: reference
status: active
---

# Pi Agent System Prompt & Debug Mode

## Overview

Documents how pi constructs its system prompt at runtime, where the source lives, and how to inspect the live assembled prompt via a debug extension.

## Details

### Package Location

Pi is installed as `@earendil-works/pi-coding-agent` via pnpm:

```
~/.local/share/pnpm/global/v11/30352-19ef3412af5/node_modules/@earendil-works/pi-coding-agent/
```

The CLI entry point is `dist/cli.js`. The system prompt logic lives in:

```
dist/core/system-prompt.js   ← buildSystemPrompt() function
```

### How the System Prompt is Built

`buildSystemPrompt()` assembles the final prompt dynamically each turn, in this order:

1. **Base prompt** (hardcoded): *"You are an expert coding assistant operating inside pi..."*
2. **Available tools list** — active tool names + their one-line `promptSnippet`s
3. **Guidelines** — from tool `promptGuidelines` + any extension-injected guidelines
4. **Pi documentation paths** — readme, docs dir, examples dir (read-only reference for pi questions)
5. **`--append-system-prompt` content** — e.g. what pi-lens injects (session guidance, turn-end findings, etc.)
6. **Project context files** — `AGENTS.md` / `CLAUDE.md` discovered in the project tree
7. **Skills** — formatted content from `~/.pi/agent/skills/`
8. **Current date** + **current working directory** (always appended last)

If `--system-prompt <text>` is passed, the hardcoded base is replaced entirely with the custom text, but steps 5–8 still apply.

### Key `before_agent_start` Event

The extension API fires `before_agent_start` before each agent loop with the **fully assembled** prompt string:

```ts
interface BeforeAgentStartEvent {
  type: "before_agent_start";
  prompt: string;                          // raw user prompt
  systemPrompt: string;                    // ← complete final system prompt
  systemPromptOptions: BuildSystemPromptOptions;
}
```

This is the best hook point for capturing the real prompt — it includes everything pi-lens appended.

`ctx.getSystemPrompt()` is also available in any extension event handler.

### Debug Extension

A debug extension was created at:

```
~/.pi/agent/extensions/debug-prompt.ts
```

It listens to `before_agent_start` and overwrites `~/pi-debug-prompt.txt` with the full system prompt on every agent turn.

**Usage:**

```bash
# Load for a single session
pi --extension ~/.pi/agent/extensions/debug-prompt.ts

# Then inspect the prompt (updates each turn)
cat ~/pi-debug-prompt.txt

# Watch character count to detect changes
watch -n1 wc -c ~/pi-debug-prompt.txt
```

To make it permanent, add the path to the `packages` array in `~/.pi/agent/settings.json`.

### Other Useful Inspection Approaches

| Approach | How |
|---|---|
| Read source directly | `cat ~/.local/share/pnpm/global/v11/.../dist/core/system-prompt.js` |
| Quick non-interactive peek | `pi -p "What is your system prompt?"` |
| Override completely | `pi --system-prompt "custom prompt here"` |
| Append to default | `pi --append-system-prompt "extra instructions"` |

### Config & Agent Directory

```
~/.pi/agent/
  settings.json       ← default model, packages, enabled models
  agents/             ← subagent definitions (.md files)
  extensions/         ← user extensions (.ts files)
  skills/             ← skill definitions
  sessions/           ← session files
  npm/                ← npm workspace for extension deps
```

The config dir can be overridden with `PI_CODING_AGENT_DIR` env var.

## Related

- [[Overview]]
- [[Subagent Extension]]
- [[Configuration]]
