---
tags: [presentation, mcp, prompt, slide-11]
type: reference
---

# Slide 11 — Real Concerns

## Prompt for Claude + PowerPoint

```
Create a slide following the design guidelines in [[Clients/Netlight/AgentNotes/Reference/netlight-design-guidelines]].

**Slide content:**
- Title: "Real Concerns"
- Subtitle: "MCP isn't free"

**Body — Four legitimate trade-offs:**

1. **Context flooding**
   "Every MCP server adds tool definitions to your context window"
   "10 servers × 5 tools each = 50 tool descriptions competing for tokens"

2. **Latency overhead**
   "JSON-RPC adds a hop. Local servers add process overhead. Remote servers add network latency."

3. **Operational complexity**
   "More moving parts: servers to run, connections to manage, failures to debug"

4. **Security surface**
   "More endpoints, more auth flows, more attack vectors"
   "Prompt injection risks multiply with more tools"

**Layout guidance:**
- Present as a 2×2 grid or vertical list
- Each concern gets a bold title + 1-2 line explanation
- Visual tone: honest, not alarmist
- Could use a subtle warning accent — but don't overdo it
- White background
- Dark Purple (#6664F1) for headers
- Keep it balanced — these are trade-offs, not dealbreakers
- Proxima Nova font
```

## Purpose

Build trust through honesty. Audience respects that we're not overselling.

## Presenter notes

- "These are real. I've hit all of them."
- Context flooding: "If you've ever seen an LLM get confused by too many tools, you know this pain"
- Security: "Simon Willison has written extensively on this — worth reading"
- Don't dwell — acknowledge and move on: "So when does direct make more sense?"
