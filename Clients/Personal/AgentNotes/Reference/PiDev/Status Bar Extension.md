---
tags: [pidev, extensions, ui, status-bar]
type: reference
status: done
created: 2026-06-03
---

# Status Bar Extension

Custom footer that replaces pi's default status bar with a single-line display showing git branch, model, thinking level, context usage (visual bar + stats), and working directory.

## Location

`~/.pi/agent/extensions/status-bar.ts`

Single-file extension, no build step required.

## Layout

```
 🌿 main · anthropic/claude-sonnet-4-5 · think:high          [████████░░░░░░] 84k/200k 42% · ~/projects/foo 
```

| Section | Position | Content |
|---------|----------|---------|
| Git branch | Left | `🌿 <branch>` — hidden entirely when not in a git repo |
| Model | Left | `<provider>/<model-id>` — provider in accent colour, id in dim |
| Thinking level | Left | `think:<level>` — always shown, even when `off` |
| Context bar | Right | `[████████░░░░░░]` 14-char fill bar, colour-coded by usage |
| Context stats | Right | `<used>/<total> <pct>%` — e.g. `84k/200k 42%` |
| Working directory | Right | `~/<path>` with `$HOME` replaced by `~` |

Sections are separated by `·` (dim). Left and right are spaced apart to fill terminal width via `visibleWidth` / `truncateToWidth` from `@earendil-works/pi-tui`.

## Context Bar Colours

The fill bar (`█`) shifts colour based on context usage:

| Usage | Colour token | Meaning |
|-------|-------------|--------|
| < 60 % | `success` | Plenty of room |
| 60 – 79 % | `warning` | Getting full |
| ≥ 80 % | `error` | Near limit |

Empty portion always rendered in `dim` (`░`). Brackets also `dim`.

When no usage data is available (e.g. immediately after compaction, before the next LLM response), the bar renders as `[░░░░░░░░░░░░░░]` and the stat shows `ctx ?`. This is expected — `getContextUsage()` returns `{ tokens: null, percent: null }` until the next assistant message is received.

## Re-render Triggers

The footer calls `tui.requestRender()` on:

| Event | Why |
|-------|-----|
| `turn_end` | Context usage updated after each LLM turn |
| `agent_end` | Covers cases where usage changes at end of agent run |
| `model_select` | Provider, model id, and thinking level may all change |
| `footerData.onBranchChange()` | Git branch changed (checkout, detach, etc.) |

## Key Implementation Details

### `requestRender` as a variable

The TUI reference is captured inside the `setFooter` factory. Rather than storing `tui` directly on a module-level variable (which could become stale across `/reload`), `requestRender` is a `() => void` variable that gets reassigned each time the footer factory runs:

```typescript
let requestRender: (() => void) | undefined;

pi.on("session_start", (_event, ctx) => {
    ctx.ui.setFooter((tui, theme, footerData) => {
        requestRender = () => tui.requestRender();
        ...
        return {
            dispose() {
                unsubBranch();
                requestRender = undefined;  // prevent dangling callback
            },
            ...
        };
    });
});
```

### No mode guard

The extension does **not** check `ctx.mode !== "tui"` before calling `setFooter`. This is intentional — `setFooter` is a no-op in non-TUI modes (the runner provides a stub), so the guard is unnecessary and was actually the root cause of the initial failure (see Debugging below).

### `getContextUsage()` shape

```typescript
interface ContextUsage {
    tokens: number | null;       // estimated input tokens in current context
    contextWindow: number;       // model's total context window size
    percent: number | null;      // tokens / contextWindow * 100, or null
}
```

`tokens` and `percent` are `null` after compaction until the next successful LLM response. Both must be checked before rendering stats.

### `fmtK()` — token formatting

```
   500  →  "500"
 1 234  →  "1.2k"
10 000  →  "10k"
84 000  →  "84k"
200 000 →  "200k"
```

Threshold: one decimal place below 10k, zero above.

## Imports

```typescript
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
```

`Theme` is a type-only import (erased at runtime). Only `truncateToWidth` and `visibleWidth` are real runtime imports from `@earendil-works/pi-tui`.

---

## Debugging: Why It Didn't Work Initially

### Root cause 1 — `minimal-footer` override

`settings.json` had this entry:

```json
{
  "source": "git:github.com/diegopetrucci/pi-extensions",
  "extensions": ["extensions/minimal-footer/index.ts"]
}
```

Packages from `settings.json` are loaded as **configured paths** (step 3 of the loader), which runs *after* global extensions in `~/.pi/agent/extensions/` (step 2). Both extensions registered a `session_start` handler that called `ctx.ui.setFooter()`. The last call wins — `minimal-footer` always ran after `status-bar.ts` and silently replaced the footer.

**Fix:** Removed the `minimal-footer` entry from `settings.json`. The `notify` extension from the same package source was kept (separate entry, no conflict).

### Root cause 2 — `ctx.mode` guard (suspected)

The original extension had:

```typescript
if (ctx.mode !== "tui") return;
```

This guard was removed in the working version. The `setFooter` call is safe to make in any mode (it's a no-op stub outside TUI), so the guard was both unnecessary and a potential silent failure point.

### Debugging approach used

1. Confirmed no other `setFooter` calls across all loaded extensions
2. Stripped to a minimal smoke test:
   ```typescript
   ctx.ui.setFooter((_tui, theme) => ({
       invalidate() {},
       render(): string[] {
           return [theme.fg("accent", " ✦ status-bar extension loaded ✦ ")];
       },
   }));
   ```
3. Smoke test appeared → mechanism confirmed working → restored full implementation without mode guard

### Extension loading order (from `loader.ts`)

```
1. .pi/extensions/          (project-local)
2. ~/.pi/agent/extensions/  (global)          ← status-bar.ts loads here
3. configuredPaths           (settings.json packages)  ← packages load here
```

Last `setFooter` call within `session_start` wins. Global extensions load *before* package extensions, so any package that also calls `setFooter` will override a global extension's footer.

---

## Related

- [[Clients/Personal/AgentNotes/Reference/PiDev/Architecture/06 - Extension System]] — extension lifecycle, `session_start`, event order
- [[Clients/Personal/AgentNotes/Reference/PiDev/Architecture/10 - Modes & UI Layer]] — `setFooter`, `FooterDataProvider`, TUI components
- [[Clients/Personal/AgentNotes/Reference/PiDev/Configuration]] — `settings.json` packages field
