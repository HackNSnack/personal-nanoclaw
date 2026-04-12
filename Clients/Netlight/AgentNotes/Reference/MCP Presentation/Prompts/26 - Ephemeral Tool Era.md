---
tags: [presentation, mcp, prompt, slide-26]
type: reference
---

# Slide 26 — The Ephemeral Tool Era

## Prompt for Claude + PowerPoint

```
Create a slide following the design guidelines in [[Clients/Netlight/AgentNotes/Reference/netlight-design-guidelines]].

**Slide content:**
- Title: "The Ephemeral Tool Era"
- Subtitle: "The integration *is* the prompt — use it once, then let it go"

**Body — Lifecycle diagram (horizontal flow):**

Three boxes in a row with arrows between them:
[Generate] → [Execute] → [Discard]

- Generate and Execute: solid purple background
- Discard: dashed border, lighter background — visually distinct to show impermanence

Below the flow: a dashed curved arrow looping from Discard back to Generate, labeled "next query"

Above Generate: small italic label "Triggered by prompt"

**Open questions section (below lifecycle):**

Small italic label: "But open questions remain:"

Three cards in a row:
- **Trust** — "Who verifies the generated code?"
- **Reproducibility** — "Same query — same result tomorrow?"
- **Governance** — "Does your audit log make sense?"

**Layout guidance:**
- Lifecycle flow centered, clean horizontal arrangement
- Dashed return arc creates a visual loop
- Question cards smaller, gray/muted background
- White background
- Netlight Purple accents
- Proxima Nova font
- Honest, exploratory tone — raising questions, not answering them
```

## Purpose

Introduce the generate-execute-discard paradigm. If tools are generated on-the-fly, MCP's persistence model may not be the only future. But this future has unsolved problems.

## Presenter notes

- "Imagine every integration is generated fresh for each query. No server to maintain, no SDK to update."
- "The tool doesn't persist between queries — it's ephemeral"
- "This is already happening for well-documented APIs"
- "But the open questions are real — trust, reproducibility, governance aren't solved yet"
- "This is honest, not dismissive — these are solvable problems, just not solved today"
