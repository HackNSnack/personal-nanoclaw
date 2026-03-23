---
tags: [presentation, mcp, prompt, slide-6]
type: reference
---

# Slide 6 — How MCP Works ⭐

## Prompt for Claude + PowerPoint

```
Create an architecture diagram slide following the design guidelines in [[Clients/Netlight/AgentNotes/Reference/netlight-design-guidelines]].

**Slide content:**
- Title: "How MCP Works"
- Subtitle: "A standardized layer between AI and tools"

**Diagram specification:**

Three-layer architecture, left to right:

LAYER 1 — MCP Host (left side)
Box labeled "MCP Host"
Subtitle: "The AI application"
Example inside or below: "Claude Desktop"
- This is what the user interacts with

LAYER 2 — MCP Client (middle, inside or connected to Host)
Smaller box or component labeled "MCP Client"
Subtitle: "Manages server connections"
- Show it as part of the Host, or as a bridge component
- The Host contains one or more Clients

LAYER 3 — MCP Servers (right side)
Three separate boxes stacked vertically:
1. "GitHub Server" (icon: branch)
2. "Jira Server" (icon: ticket)
3. "Slack Server" (icon: chat)
Subtitle above: "MCP Servers — provide tools & data"

Connections:
- Draw clean lines from MCP Client to each server
- Lines should be neat and parallel (contrast with Slide 3's spaghetti)
- Use arrows to show bidirectional communication
- Label the connection: "JSON-RPC 2.0" (small, subtle)

**Key visual point:**
The MCP layer creates a clean interface. One standard protocol, multiple servers.

**Layout guidance:**
- Horizontal flow: Host → Client → Servers
- Diagram takes 70% of slide
- Use Dark Purple (#6664F1) for boxes/borders
- Use Light Purple (#C6C6FF) for fills or backgrounds
- White slide background
- Clean, geometric shapes — no organic/hand-drawn style
- Connection lines in Netlight Purple (#A29AFF)
- Labels in Proxima Nova, clear hierarchy
- Optional: small icons inside server boxes for recognition

**Annotations (small text near components):**
- Near Host: "Where the LLM runs"
- Near Client: "Handles discovery & invocation"
- Near Servers: "Expose tools, resources, prompts"
```

## Purpose

Make the architecture tangible. Audience should understand the three roles and how they connect.

## Presenter notes

- Walk through left to right: "You have your AI app — the Host. Inside it, a Client manages connections. On the right, Servers provide capabilities."
- Point out the clean lines: "Compare this to the spaghetti from earlier"
- Emphasize: "The Client doesn't care what servers exist. Servers don't care which Host is calling. That's the decoupling."
- Keep it high-level — don't dive into JSON-RPC details here
