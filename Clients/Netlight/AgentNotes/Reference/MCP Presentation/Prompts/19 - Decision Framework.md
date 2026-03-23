---
tags: [presentation, mcp, prompt, slide-19]
type: reference
---

# Slide 19 — Decision Framework

## Prompt for Claude + PowerPoint

```
Create a slide following the design guidelines in [[Clients/Netlight/AgentNotes/Reference/netlight-design-guidelines]].

**Slide content:**
- Title: "Decision Framework"
- Subtitle: "Which approach for which situation"

**Body — Two-column decision guide:**

**Use MCP when:**
✓ You want external users to connect with their own AI tools
✓ You're building for an ecosystem, not a single app
✓ Self-serve onboarding matters
✓ You want to be where users already are
✓ Reach matters more than control
✓ You'd rather maintain one server than many SDKs

**Use Direct when:**
✓ You control the full user experience
✓ Accuracy is critical
✓ You need specific prompting and guardrails
✓ You have one primary interface
✓ Control matters more than reach
✓ You want predictable, testable behavior

**Optional: Simple flowchart alternative**

Start: "Who controls the LLM?"
→ "The user does" → MCP
→ "We do" → Direct

Or:

Start: "Where do users interact?"
→ "In their own AI tools" → MCP
→ "In our interface" → Direct

**Layout guidance:**
- Two clean columns: MCP on left, Direct on right
- Checkmarks or bullets for each criterion
- Equal visual weight — neither is "better"
- White background
- Use Netlight Purple (#A29AFF) for MCP column accent
- Use Yellow (#FFF400) or neutral for Direct column accent (or keep both purple)
- If using flowchart, keep it simple — 2-3 decision points max
- Proxima Nova font
- Scannable — audience should find themselves quickly
```

## Purpose

Give the audience a practical tool. They should be able to point at the slide and say "that's us."

## Presenter notes

- "This is the cheat sheet"
- "Ask yourself: who controls the LLM? If it's your users — MCP. If it's you — direct."
- "Most of you will end up somewhere in between. That's fine — run both."
- Transition: "So how do you actually get started?"
