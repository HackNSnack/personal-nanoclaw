---
tags: [presentation, mcp, prompt, slide-17]
type: reference
---

# Slide 17 — Side by Side

## Prompt for Claude + PowerPoint

```
Create a slide following the design guidelines in [[Clients/Netlight/AgentNotes/Reference/netlight-design-guidelines]].

**Slide content:**
- Title: "Side by Side"
- Subtitle: "Our MCP server vs our direct agent"

**Body — Comparison table from real experience:**

| Dimension              | MCP Server                        | Direct Agent                     |
|------------------------|-----------------------------------|----------------------------------|
| **Accuracy**           | Lower — no prompt control         | Higher — optimized prompts       |
| **Tool selection**     | LLM picks from all tools          | We control the flow              |
| **Prompting control**  | None — customer's LLM decides     | Full — we craft every prompt     |
| **Reach**              | Any AI tool, any customer         | Only our chat interface          |
| **Scalability**        | M+N — scales across platforms     | Single touchpoint                |
| **Testing**            | Hard — many LLM variants          | Easy — one controlled path       |
| **User onboarding**    | Self-serve, minutes               | Through our UI only              |

**Bottom line (below table):**
"MCP: reach and flexibility. Direct: control and accuracy."
"We run both."

**Layout guidance:**
- Clean comparison table, two columns
- Header row highlighted in Dark Purple (#6664F1)
- Alternate row shading optional (Light Purple #C6C6FF)
- Keep cells concise — short phrases, not sentences
- White background
- Proxima Nova font
- Neutral presentation — neither is "winner", both have place
```

## Purpose

Show the real trade-off from lived experience. Not theoretical — this is what we actually see.

## Presenter notes

- "This isn't hypothetical. We run both, side by side."
- Highlight the key tension: "MCP gives us reach. Direct gives us control."
- "The direct agent is more accurate — but it only works in our interface"
- "MCP works everywhere — but we're at the mercy of how customers configure their LLMs"
- Transition: "So what's our verdict?"
