---
tags: [presentation, mcp, prompt, slide-3]
type: reference
---

# Slide 3 — The M×N Problem

## Prompt for Claude + PowerPoint

```
Create a diagram slide following the design guidelines in [[Clients/Netlight/AgentNotes/Reference/netlight-design-guidelines]].

**Slide content:**
- Title: "The M×N Problem"
- Subtitle or caption: "Every app rebuilds every integration"

**Diagram specification:**

Left side — AI Applications (M = 4):
1. Claude Desktop (icon: chat bubble or Claude logo placeholder)
2. Internal Agent (icon: robot or bot)
3. VS Code + Claude (icon: code editor)
4. Support Bot (icon: headset or help)

Right side — Tools/Services (N = 3):
1. GitHub (icon: GitHub logo or code branch)
2. Jira (icon: Atlassian logo or ticket)
3. Slack (icon: Slack logo or chat)

Connections:
- Draw a line from EVERY app on the left to EVERY tool on the right
- Result: 12 crossing lines (4×3)
- Lines should look messy/chaotic — this is the point
- Use a muted color for lines (gray or light purple) to show burden

Below the diagram:
- Text: "4 apps × 3 tools = 12 custom integrations"
- Optional: "Add one more tool? 4 more integrations."

**Layout guidance:**
- Clean two-column layout: apps on left, tools on right
- Diagram dominates the slide (60-70% of space)
- Title at top
- Spaghetti lines should feel overwhelming but still readable
- White background
- Icons can be simple shapes or placeholders — clarity over decoration
- Use Dark Purple (#6664F1) for the app/tool boxes
- Use Light Purple (#C6C6FF) or gray for the connecting lines
- Proxima Nova font for all text
```

## Purpose

Make the scaling problem visceral. The audience should look at this and feel "yeah, that's a mess."

## Presenter notes

- Point at the lines: "Every one of these is custom code someone wrote and maintains"
- "Now imagine 10 apps and 10 tools — that's 100 integrations"
- Pause before next slide to let it sink in
