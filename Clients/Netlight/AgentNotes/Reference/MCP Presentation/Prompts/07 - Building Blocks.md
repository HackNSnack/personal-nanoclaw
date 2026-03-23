---
tags: [presentation, mcp, prompt, slide-7]
type: reference
---

# Slide 7 — The Building Blocks

## Prompt for Claude + PowerPoint

```
Create a slide following the design guidelines in [[Clients/Netlight/AgentNotes/Reference/netlight-design-guidelines]].

**Slide content:**
- Title: "The Building Blocks"
- Subtitle: "What MCP servers expose"

**Body — Three primitives, Tools emphasized:**

**1. Tools (PRIMARY FOCUS — 60% of slide real estate)**
Bold header: "Tools"
Definition: "Functions the AI can execute"

Concrete examples (as a list or small cards):
- `create_issue` — Create a Jira ticket
- `search_code` — Search a GitHub repository
- `send_message` — Post to a Slack channel
- `run_query` — Execute a database query

Visual: Could show these as small code-like snippets or action cards

**2. Resources (SECONDARY — brief mention)**
Header: "Resources"
One line: "Read-only data sources — files, records, API responses"

**3. Prompts (SECONDARY — brief mention)**
Header: "Prompts"
One line: "Reusable templates for common LLM interactions"

**Layout guidance:**
- Tools section dominates: top or left, with the examples clearly visible
- Resources and Prompts below or to the side, visually smaller
- Consider a visual hierarchy: Tools in a larger box/card, Resources and Prompts as smaller footnotes
- White background
- Use Dark Purple (#6664F1) for the Tools section header/border
- Use Light Purple (#C6C6FF) or gray for Resources/Prompts sections
- Tool examples could use monospace font for the function names, Proxima Nova for descriptions
- Clean and scannable
```

## Purpose

Ground the architecture in concrete capabilities. Audience should think: "Oh, so it can actually DO things."

## Presenter notes

- Focus on Tools: "This is where the action happens — 90% of what you'll use"
- Briefly wave at Resources/Prompts: "These exist too, but Tools are the workhorse"
- The examples should resonate: "You've probably wanted exactly these integrations"
