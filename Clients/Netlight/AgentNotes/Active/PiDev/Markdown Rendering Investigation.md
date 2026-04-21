---
tags: [pidev, markdown, rendering, terminal]
type: work
status: done
created: 2026-04-21
---

# Markdown Rendering Investigation

## Problem

Pi.dev outputs markdown in terminal, but kitty doesn't render it - shows raw markdown text. Investigated options to get prettier rendering while maintaining terminal-based workflow.

## Options Explored

### 1. Streamdown (Python CLI)
**Source**: https://github.com/day50-dev/Streamdown

- Terminal-based markdown renderer for LLM output
- Supports streaming via `--exec` flag: `sd --exec pi`
- Works with kitty graphics protocol

**Rejection**: Found different Streamdown that looked better

### 2. Streamdown (Vercel/React)
**Source**: https://streamdown.ai

- React component library for web apps
- Beautiful rendering with syntax highlighting, Mermaid, LaTeX
- Powers Mintlify, Supabase, Ollama UI

**Rejection**: Not a CLI tool - designed for browser/web apps, not terminals

### 3. Browser + Terminal Hybrid Approaches

Investigated multiple ways to get browser-quality rendering while keeping terminal interaction:

**Option A: Split View (File Watching)**
- Pi writes markdown to file
- Browser watches file, auto-refreshes
- Terminal + browser side-by-side

**Option B: WebSocket Server Extension**
- Pi extension runs Express server
- Serves React app with Vercel Streamdown
- Real-time updates via WebSocket
- Terminal + browser side-by-side

**Option C: Inline Terminal Rendering (Kitty Graphics)**
- Render markdown to PNG via headless browser
- Display inline in terminal via kitty graphics protocol
- Everything in terminal, but output is image (can't copy text)

**Option D: Picture-in-Picture**
- Small floating browser window
- Terminal stays fullscreen

**Option E: Transparent Overlay**
- Browser with transparent background over terminal

**Rejection**: All require split screen or lose text interactivity. Doesn't fit centralized terminal workflow.

### 4. Glow
**Source**: https://github.com/charmbracelet/glow

- Terminal markdown renderer from Charm
- Syntax highlighting, styled headers/lists/tables
- No streaming support (needs complete markdown)

**Integration options**:
- Post-response rendering: `/glow` command after Pi responds
- Non-interactive: `pi -p "query" | glow`
- File-based with tmux split panes

**Rejection**: Requires either:
- Manual command after each response
- Split screen (tmux panes)
- Non-interactive mode

Still too much friction for daily use.

## Decision

**Not implementing any markdown rendering solution.**

**Reasons**:
1. **Too much effort** - All solutions require significant setup/maintenance
2. **Doesn't fit workflow** - Want everything centralized in terminal without splits/windows
3. **Trade-offs unacceptable** - Either lose interactivity, require split screen, or can't copy text

**Conclusion**: Staying with raw markdown in terminal. Readable enough, no additional complexity.

## Key Insight

**No perfect solution exists** for browser-quality rendering fully integrated in terminal:
- Terminals are text-based devices
- True rich rendering requires browser engine
- Any hybrid approach requires compromise (split screen, images, or separate windows)

For terminal-centric workflow, raw markdown is the pragmatic choice.

## Related Notes

- [[PiDev/Overview]]
- [[PiDev/Configuration]]
