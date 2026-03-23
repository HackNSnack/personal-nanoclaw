---
tags: [presentation, mcp, prompt, slide-16]
type: reference
---

# Slide 16 — What Bit Us

## Prompt for Claude + PowerPoint

```
Create a slide following the design guidelines in [[Clients/Netlight/AgentNotes/Reference/netlight-design-guidelines]].

**Slide content:**
- Title: "What Bit Us"
- Subtitle: "Lessons from production"

**Body — Real challenges we faced:**

1. **Context limits hurt early on**
   "Our initial setup had ~20k token limits. Tool definitions alone ate most of it."
   "Today's 1M+ context windows help — but it's still a cost."

2. **Context flooding**
   "The LLM sees all tools at once. With many tools, it struggles to pick the right one."
   "More tools ≠ better. Sometimes it means more confusion."

3. **Accuracy suffered**
   "Wrong tool selection. Hallucinated parameters. Misunderstood responses."
   "The more tools, the more ways to go wrong."

4. **No control over the system prompt**
   "The customer's LLM has its own system prompt. We can't influence it."
   "Can't guide behavior, add guardrails, or optimize for our tools."

5. **Can't test every LLM**
   "Customers use Claude, GPT-4, Gemini, open-source models — whatever they want."
   "We can't replicate every behavior. Edge cases slip through."

**Layout guidance:**
- Present as 5 cards or a numbered list
- Each challenge: bold title + honest explanation
- Tone: candid, not complaining — these are learnings
- Could use a subtle visual cue (orange or muted color) to signal "caution" — but don't overdo
- White background
- Dark Purple for headers
- Proxima Nova font
- Balance with Slide 15 — wins were real, but so were these
```

## Purpose

Build trust through honesty. Show that MCP isn't magic — it has real challenges.

## Presenter notes

- "Context flooding was the biggest surprise. More tools made things worse, not better."
- "The system prompt one stings — you're at the mercy of however the customer has configured their AI."
- "We can't control which LLM customers use. That's a feature — but also a testing nightmare."
- "These aren't reasons to avoid MCP. They're things to design around."
- Transition: "So how does this compare to our direct integration?"
