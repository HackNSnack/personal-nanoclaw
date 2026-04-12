---
tags: [presentation, mcp, structure]
type: reference
---

# MCP Presentation - Slide Structure

**Duration:** 45 min talk + 15 min Q&A
**Audience:** Mixed technical/business, decision-makers and practitioners
**Goal:** Education + lessons learned from production use
**Key takeaway:** What MCP is, why we use it, why they should use/create it

## Story Arc

1. **Act 1 — The Problem** (5 min): Set up the pain of fragmented integrations
2. **Act 2 — The Solution** (10 min): Introduce MCP, how it works, ecosystem
3. **Act 3 — The Skeptic** (10 min): Steel-man "just connect directly" argument
4. **Act 4 — Our Experience** (12 min): Production lessons, both approaches
5. **Act 5 — Framework & CTA** (5 min): When to use what, call to action
6. **Act 6 — The Future** (3 min): Challenge assumptions, open-ended close

---

## Act 1 — The Problem (~5 min)

### Slide 1: Title Slide
- **Purpose:** Set the stage
- **Content:** "MCP; 2025's hottest AI-topic: What is MCP, and why do we use it?" — Mathias Pettersen, Netlight, 14 April 2026

### Slide 2: "Everyone's Building the Same Thing"
- **Purpose:** Hook — create recognition
- **Content:** Anecdote about teams building the same integrations from scratch, repeatedly.

### Slide 3: The M×N Problem
- **Purpose:** Visualize the pain
- **Content:** Diagram: 4 AI apps (Claude Desktop, Internal Agent, VS Code, Support Bot) × 3 tools (GitHub, Jira, Slack) = 12 spaghetti integrations.

### Slide 4: The Cost of Fragmentation
- **Purpose:** Make it tangible
- **Content:** Duplicated effort, inconsistent security, no reuse, maintenance burden.

---

## Act 2 — The Solution (~10 min)

### Slide 5: Enter MCP
- **Purpose:** Introduce the protocol
- **Content:** One-liner definition. Origin (Anthropic, Nov 2024). Now Linux Foundation's AAIF.

### Slide 6: How MCP Works ⭐ [Visualization]
- **Purpose:** Architecture visualization
- **Content:** Diagram: Host → Client → Server. Show the decoupling with GitHub, Jira, Slack servers.

### Slide 7: The Building Blocks
- **Purpose:** Explain primitives
- **Content:** Tools (primary focus with examples: create_issue, search_code, send_message, run_query), Resources and Prompts (brief mention).

### Slide 8: M+N, Not M×N
- **Purpose:** Show the payoff
- **Content:** Same diagram as slide 3, but with MCP hub in the middle. 7 clean lines instead of 12.

### Slide 9: The Ecosystem Today
- **Purpose:** Establish credibility
- **Content:** 1,000+ servers, AAIF governance, backers (Anthropic, OpenAI, Google, Microsoft, AWS, Block, Cloudflare).

---

## Act 3 — The Skeptic (~12 min)

### Slide 10: "Just Connect Directly"
- **Purpose:** Steel-man the counterargument
- **Content:** The skeptic's pitch: simpler architecture, lower latency, tighter control, proven approach.

### Slide 11: Real Concerns
- **Purpose:** Acknowledge legitimate criticism
- **Content:** Context flooding, latency overhead, operational complexity, security surface.

### Slide 12: The Context Flood ⭐ [Visualization]
- **Purpose:** Deep dive into the #1 technical challenge
- **Content:** Three mechanic cards (every tool = tokens, all loaded at once, zero-sum budget). Animated bar chart showing token budget breakdown at 5/20/50 tools. Punchline: "More tools, less room to think."
- **Fragment order:** Heading → 5 tools → 20 tools → 50 tools → punchline → mechanic cards
- **Layout notes:** Bar chart scaled 1.25x via CSS transform. Bars use clipPath for clean rounded borders. Narrow 5-tools bar has two-line "Tool defs" label.

### Slide 13: When It Breaks
- **Purpose:** Show what happens when context floods
- **Content:** Concrete failure modes from context flooding.

### Slide 14: Taming the Flood
- **Purpose:** Mitigation strategies
- **Content:** Approaches to manage context flooding in practice.

### Slide 15: When Direct Wins
- **Purpose:** Show intellectual honesty
- **Content:** Single app, few stable tools, performance-critical, highly specialized, rapid prototyping.

### Slide 16: The Honest Trade-off
- **Purpose:** Transition to rebuttal
- **Content:** Table comparing Direct vs MCP on: control, simplicity, speed, reusability, ecosystem, scalability, future-proofing.

---

## Act 4 — Our Experience (~12 min)

### Slide 17: Our Setup
- **Purpose:** Ground it in reality
- **Content:** We're an MCP *provider* — we expose an MCP server to customers. They connect their AI tools, pass API token, query our data. Currently read-only, write coming soon.
- **Animations:** Flow diagram reveals step-by-step (fragment-index 0-2), then "How it works" (3), "Tools exposed" (4), closing line (5).

### Slide 18: What MCP Gave Us
- **Purpose:** Concrete wins
- **Content:** One integration for all AI tools, no vendor lock-in, faster customer onboarding, accessible to less technical users, future-proof.

### Slide 19: What Bit Us
- **Purpose:** Lessons learned
- **Content:** Five challenges: context limits (~20k early on), context flooding, accuracy issues, no control over system prompt, can't test every LLM variant.

### Slide 20: Side by Side
- **Purpose:** Direct comparison
- **Content:** Table comparing our MCP server vs our direct agent on: accuracy, tool selection, prompting control, reach, scalability, testing, onboarding.

### Slide 21: The Verdict
- **Purpose:** Our recommendation
- **Content:** "Use MCP to be accessible. Use direct to be excellent." MCP = distribution strategy. Direct = product experience strategy. Run both.
- **Animations:** Statement (0), then MCP column (1), Direct column (2), closing line (3) — each fragment builds the argument progressively.

---

## Act 5 — Framework & Call to Action (~5 min)

### Slide 22: Decision Framework
- **Purpose:** Give them a tool
- **Content:** Two-column checklist: "Use MCP when..." vs "Use direct when..." Key question: "Who controls the LLM?"
- **Animations:** MCP column (0), Direct column (1), key question (2) — fragments reveal each side before the unifying question.

### Slide 23: Getting Started
- **Purpose:** Lower the barrier
- **Content:** Three steps: try an existing server, read the spec, build your own. Links to modelcontextprotocol.io and GitHub.

### Slide 24: Build or Adopt?
- **Purpose:** Call to action
- **Content:** Two paths: Adopt (use existing servers) vs Build (create server for your product). Both contribute to the ecosystem.
- **Animations:** Adopt column (0), Build column (1), closing line (2) — reveal each path before the unifying message.

---

## Act 6 — The Future (~3 min)

### Slide 25: What If Building Is Free?
- **Purpose:** Challenge the fundamental M×N assumption
- **Content:** Cost collapse timeline: 10 days (2020, write from scratch) → 10 hours (2023, AI-assisted) → 10 minutes (2025, prompt the right LLM). Punchline: "If M×N costs nothing — does the problem still exist?"
- **Animations:** Each timeline step reveals sequentially (0-2), then punchline (3).

### Slide 26: The Ephemeral Tool Era
- **Purpose:** Introduce the generate-execute-discard paradigm
- **Content:** Lifecycle diagram: Generate → Execute → Discard, with dashed return arc ("next query"). Open questions: Trust (who verifies?), Reproducibility (same result tomorrow?), Governance (audit log?).
- **Animations:** Generate box + "Triggered by prompt" label (0), Execute (1), Discard with dashed border (2), return arc (3), "open questions" label (4), then three question cards (5-7).

### Slide 27: Two Plausible Futures
- **Purpose:** Leave the audience with an open question — don't resolve it
- **Content:** SVG fork diagram: timeline from MCP launch (Nov 2024) → Agents read APIs (2025) → NOW → fork into Future A (Standards win — MCP as lingua franca) vs Future B (Generation wins — every tool ephemeral & bespoke). Italic footer: "The answer probably depends on how good agents get at trust and verification — and we're not there yet."
- **Speaker notes:** The question IS the point. Good Q&A anchor: "Which future are you building for right now?"

### Slide 28: Thank You + Q&A
- **Purpose:** Close
- **Content:** Minimal. "Thank you. Questions?" Key takeaway reminder: "MCP to be accessible. Direct to be excellent." Resources: modelcontextprotocol.io, github.com/modelcontextprotocol. Netlight branding.
- **Animations:** Takeaway quote (0), resource links (1).

---

## Related

- [[Clients/Ardoq/AgentNotes/Reference/Model Context Protocol (MCP)]] - MCP research notes
- [[Clients/Netlight/AgentNotes/Reference/netlight-design-guidelines]] - Slide design guidelines
