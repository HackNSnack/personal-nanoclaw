---
tags: [presentation, mcp, prompt, slide-14]
type: reference
---

# Slide 14 — Our Setup

## Prompt for Claude + PowerPoint

```
Create a slide following the design guidelines in [[Clients/Netlight/AgentNotes/Reference/netlight-design-guidelines]].

**Slide content:**
- Title: "Our Setup"
- Subtitle: "MCP in production — as a provider"

**Body — Describe the architecture:**

**Key point: We expose an MCP server to customers**

Simple flow diagram or description:

Customer's AI App → Our MCP Server → Internal API → Data

**How it works:**
- Customers connect their AI tools to our MCP server
- They pass an API token for authentication
- Our server forwards requests to our internal API
- Currently read-only, write capabilities coming soon

**Tools we expose:**
- Read metamodel
- Read reports
- Get definitions
- Aggregate data
- Count instances
- (and more)

**The angle:**
"We're not just using MCP — we're providing it"

**Layout guidance:**
- Simple flow diagram showing: Customer AI → MCP Server → Internal API
- Or a clean list/card layout describing the setup
- Keep it simple — this is context-setting, not deep architecture
- White background
- Use Netlight Purple for the MCP Server box to highlight it
- Proxima Nova font
- Optional: small "read-only (for now)" badge or note
```

## Purpose

Establish credibility: we're not theorizing — we run this in production, and we're on the provider side.

## Presenter notes

- "We took a different angle — we're not just consuming MCP, we're exposing it"
- "Our customers can plug their AI tools into our platform via MCP"
- "One integration on our side, works with whatever AI tools they use"
- This is the M+N benefit from the provider perspective
