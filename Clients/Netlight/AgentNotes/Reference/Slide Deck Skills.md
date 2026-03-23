---
tags: [presentations, skills, framework]
type: reference
status: done
---

# Slide Deck Skills

A framework of Claude Code skills for creating reveal.js presentations. Read this to understand the available tools before starting presentation work.

Skills are at `~/.claude/skills/<name>/SKILL.md`. Invoke with `/<name>`.

## Workflow

```
/story → /outline → /new-deck → /new-slide (repeat) → /layout → /animate → /review-deck
```

## Skills

### /story — Ideation
Takes a topic and crafts a narrative arc. Asks about audience, tone, key takeaways, duration. Outputs a `story.md` with sections: opening hook, context, key sections, turning point, closing.

### /outline — Planning
Turns a story into a slide-by-slide outline. Each slide gets: number, title, type, purpose, key message, content description, speaker notes. Outputs `outline.md`. No code — just a content blueprint.

### /new-deck — Scaffolding
Creates a full Vite + React 19 + Reveal.js 6.0 project directory. Generates all boilerplate: package.json, tsconfig, vite config, theme.ts, index.css, App.tsx, CODE_GUIDELINES.md, and a title slide. Optionally adapts theme.ts from a design guide document.

### /new-slide — Slide Creation
Interactive single-slide builder. Reads the deck's theme and guidelines, asks about slide type and content, generates a `.tsx` component, and registers it in App.tsx. Supports types: content, title, transition, card-grid, list, comparison, quote, code, image. Creates slides WITHOUT animations (use /animate separately).

### /layout — Visual Polish
Fixes alignment, spacing, and sizing on a specific slide. Analyzes the slide for issues (inconsistent spacing, hardcoded values, missing theme tokens, poor text hierarchy) and proposes targeted fixes. Only touches styling, never content.

### /animate — Animations
Adds reveal.js fragment animations and custom CSS effects to a slide. Presents an animation plan (what appears when) for approval before implementing. Handles: basic fragments, ordered reveals, grouped reveals, SVG line drawing, staggered entrances, scale/fade effects.

### /review-deck — Review
Reviews the entire deck holistically. Evaluates: narrative flow, information density, visual consistency, readability, animation quality, technical correctness. Outputs feedback in three tiers: critical, improvements, polish. References specific files and line numbers.

## Technical Context

- Each deck is a standalone Vite project in its own directory under the repo
- Slides are React `.tsx` components, one per file, numbered `{NN}-{kebab-name}.tsx`
- All styling uses inline styles with centralized theme tokens from `theme.ts`
- No CSS modules, no Tailwind — inline styles + `index.css` for global overrides
- Each deck has a `CODE_GUIDELINES.md` with full conventions
- Design guide template at `templates/design-guide-template.md` in the repo

## Related

- Repo: `/home/mathipe/Prosjekter/Netlight/Presentations/revealjs-presentations/`
- [[netlight-design-guidelines]]
