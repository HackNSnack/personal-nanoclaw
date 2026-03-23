---
tags: [presentations, claude-code, ai-tooling, outline]
type: reference
---

# Claude Code & AI Tooling — Slide Outline

**Slides:** 22
**Estimated duration:** ~30 minutes

---

### 01 — Title
- **Type:** title
- **Purpose:** Set the stage and establish the speaker
- **Key message:** This is a talk about AI tooling — the honest version
- **Content:** "Claude Code & AI Tooling — What Actually Works" / Speaker name, date, Netlight logo
- **Speaker notes:** Brief intro of yourself and what you'll cover

### 02 — The Headlines
- **Type:** content
- **Purpose:** Acknowledge the hype — it's loud and it's everywhere
- **Key message:** The AI narrative is breathless, and it's hard to know what to take seriously
- **Content:** 3-4 real headlines/quotes: "AI will replace developers," "10x productivity," "prompt engineering is the new coding" — styled like news clippings or social posts
- **Speaker notes:** You've seen these. LinkedIn, Twitter, every keynote. The noise is constant and it's hard to separate signal from hype.

### 03 — Things Have Changed
- **Type:** transition
- **Purpose:** Acknowledge the real shift — don't dismiss it
- **Key message:** AI tooling has genuinely changed how we work, and pretending otherwise is just as wrong as the hype
- **Content:** "Things *have* changed." — large, centered. Then a few grounding examples: code review with AI, automated test drafts, codebase exploration in minutes instead of days
- **Speaker notes:** Here's the thing though — things have actually shifted. If you're writing code the same way you did two years ago, you're probably leaving value on the table. The tools are real, the capabilities are real, and they're changing how teams operate.

### 04 — But It's Not What the Headlines Say
- **Type:** content
- **Purpose:** Thread the needle — powerful tool, not a silver bullet
- **Key message:** AI is a genuine shift in how we work, but it doesn't solve everything — and that's fine
- **Content:** Two sides. Left: "What's real" — faster iteration, less tedious work, new capabilities. Right: "What's not" — it won't replace thinking, it hallucinates, it doesn't know your business. Bottom: "The gap between these two is where this talk lives."
- **Speaker notes:** Both things are true. AI tooling is genuinely powerful — and it's genuinely limited. The hype says it solves everything. The skeptics say it solves nothing. Reality is in between, and that's actually a more interesting place to be.

### 05 — What This Talk Is About
- **Type:** content
- **Purpose:** Set expectations now that the framing is clear
- **Key message:** Practical, honest — how to adapt without buying the hype
- **Content:** Short list. This talk: honest assessment of where we are, practical workflows you can adopt, how to adapt incrementally — not a transformation manifesto
- **Speaker notes:** So that's what we're doing for the next 25 minutes. No hype, no dismissal. Just: here's what works, here's what doesn't, and here's how to start adapting at your own pace.

### 06 — The Spectrum
- **Type:** transition
- **Purpose:** Bridge from framing into the landscape overview
- **Key message:** AI coding tools aren't one thing — they're a spectrum
- **Content:** Simple visual: a spectrum line from "Autocomplete" on the left to "Autonomous Agent" on the right
- **Speaker notes:** Let's talk about what's actually out there. Not all AI tools are the same — they sit on a spectrum.

### 07 — Chat Assistants
- **Type:** content
- **Purpose:** Cover the first category of tools
- **Key message:** Good for Q&A and exploration, limited by lack of codebase context
- **Content:** ChatGPT, Claude.ai, etc. What they do well: explain concepts, draft snippets, rubber-duck debugging. Limitation: they don't see your code.
- **Speaker notes:** This is where most people start. Paste some code into a chat, ask a question. It works, but it's like asking a colleague who's never seen your repo.

### 08 — Inline Copilots
- **Type:** content
- **Purpose:** Cover the second category
- **Key message:** Useful for line-level speed, less useful for larger reasoning
- **Content:** GitHub Copilot, Codeium, etc. What they do: autocomplete on steroids, in-editor suggestions. Limitation: single-file context, can't reason about your system.
- **Speaker notes:** The next step up. These live in your editor and predict what you're about to type. Great for boilerplate, less great for anything that requires understanding how things connect.

### 09 — Agentic Tools
- **Type:** content
- **Purpose:** Cover the third category — where Claude Code lives
- **Key message:** These tools can read, reason about, and modify your codebase
- **Content:** Claude Code, Cursor, Windsurf, etc. What they do: read your full repo, propose multi-file changes, run commands. Key difference: they have context.
- **Speaker notes:** This is the category we'll spend most of our time on. These tools can actually navigate your codebase, understand relationships between files, and make changes across multiple files at once.

### 10 — No "Best Tool"
- **Type:** transition
- **Purpose:** Prevent the "which one should I use?" distraction
- **Key message:** The categories matter more than the specific tools — pick what fits your workflow
- **Content:** "There is no best tool. There's the one that fits how you work." — centered statement
- **Speaker notes:** I'm not going to rank these. They all have tradeoffs. The point is understanding what each category can do so you can make an informed choice. I'll focus on Claude Code because that's what I use daily.

### 11 — What Is Claude Code?
- **Type:** content
- **Purpose:** Introduce Claude Code specifically
- **Key message:** A terminal-based AI agent that works with your actual codebase
- **Content:** Brief description: runs in your terminal, reads your repo, proposes changes, can execute commands. Not an IDE plugin — it's an agent.
- **Speaker notes:** Claude Code is a CLI tool. You point it at your project, describe what you want, and it reads your files, reasons about the structure, and proposes changes. It can also run tests, check git status, install packages — it operates in your environment.

### 12 — A Real Workflow
- **Type:** content
- **Purpose:** Show — don't tell — what using it actually looks like
- **Key message:** It's a conversation with your codebase, not a magic button
- **Content:** Step-by-step walkthrough of a real task (e.g., "add input validation to an API endpoint"). 3-4 steps: describe task → it reads relevant files → proposes changes → you review and adjust
- **Speaker notes:** Let me walk you through what a typical session looks like. This isn't a contrived demo — it's a Tuesday afternoon.

### 13 — Where It Genuinely Helps
- **Type:** list
- **Purpose:** Concrete wins — build credibility with real examples
- **Key message:** There are specific categories of work where AI tooling shines
- **Content:** 4-5 items: multi-file refactors, boilerplate/scaffolding, exploring unfamiliar codebases, first drafts of tests, repetitive transformations
- **Speaker notes:** These are the places where I've seen consistent value. Not "sometimes it works" — these reliably save time and effort.

### 14 — Where It Falls Short
- **Type:** list
- **Purpose:** Build trust by being honest about limitations
- **Key message:** It's confidently wrong in predictable ways — know the failure modes
- **Content:** 4-5 items: hallucinated APIs, architecture decisions, business context, security edge cases, "it refactors 500 lines flawlessly, then invents a function that doesn't exist"
- **Speaker notes:** And here's the other side. These aren't edge cases — these are things that happen regularly. You will get output that looks perfect and is subtly wrong. That's why review isn't optional.

### 15 — The Trust Model
- **Type:** content
- **Purpose:** Reframe the relationship — it's a tool, not an oracle
- **Key message:** The value isn't blind trust, it's faster iteration
- **Content:** "Trust but verify" framing. You're not outsourcing thinking — you're getting a fast first draft. The skill is knowing when to accept, when to adjust, when to reject.
- **Speaker notes:** Think of it like a very fast junior developer who's read a lot of code but doesn't know your system. You wouldn't merge their PR without reviewing it. Same principle.

### 16 — Practical Workflows
- **Type:** transition
- **Purpose:** Shift from "what is it" to "how do I use it"
- **Key message:** Let's get concrete
- **Content:** Section title: "The Small Wins" — simple, large text
- **Speaker notes:** Enough theory. Let's talk about specific things you can do with this.

### 17 — Workflow: Test First Drafts
- **Type:** content
- **Purpose:** Show a specific, relatable workflow
- **Key message:** Let AI write the boring test scaffolding, you focus on the edge cases
- **Content:** Example: "Write tests for this service" → generates 80% of test cases → you add the tricky edge cases and business logic tests
- **Speaker notes:** Writing tests is one of the highest-value use cases. Not because it writes perfect tests — but because it handles the scaffolding and obvious cases, freeing you to think about the hard ones.

### 18 — Workflow: Codebase Exploration
- **Type:** content
- **Purpose:** Show another practical workflow
- **Key message:** AI is excellent at navigating code you've never seen before
- **Content:** Example: "How does authentication work in this repo?" → it reads the relevant files, traces the flow, and summarizes it for you
- **Speaker notes:** Ever joined a project and spent days figuring out how things connect? This is where agentic tools save real time. They can read and cross-reference faster than you can grep.

### 19 — Workflow: Repetitive Refactors
- **Type:** content
- **Purpose:** Show a third workflow
- **Key message:** The tedious, mechanical work is exactly where AI fits
- **Content:** Example: rename a pattern across 20 files, migrate an API, update imports. The stuff that's simple but time-consuming.
- **Speaker notes:** This is the "I could do it, but it'd take an hour of find-and-replace" category. Let the tool handle the mechanical part.

### 20 — The Real Shift
- **Type:** transition
- **Purpose:** Deliver the turning point of the talk
- **Key message:** It's not about AI doing your job — it's about what you spend your attention on
- **Content:** "The question isn't whether AI can code. It's what you do with the time it saves." — centered, prominent
- **Speaker notes:** Here's what I think the real shift is. When the tedious parts get faster, you naturally spend more time on the hard problems — the architecture, the design, the edge cases that need a human. That's not hype. That's just a better workday.

### 21 — One Thing This Week
- **Type:** content
- **Purpose:** Deliver the call-to-action
- **Key message:** Don't transform your workflow — just try one thing
- **Content:** "Pick one task from this week that felt repetitive. Try it with AI next week." No manifesto. No transformation roadmap. Just one thing.
- **Speaker notes:** I'm not asking you to change how you work. I'm asking you to try one thing. One task. See if it helps. If it does, try another. If it doesn't, you've lost nothing. That's it.

### 22 — Thank You
- **Type:** closing
- **Purpose:** Clean ending with contact info
- **Key message:** The door is open for questions and conversation
- **Content:** "Thank you" / speaker name / contact info / Q&A prompt
- **Speaker notes:** Thanks for listening. Happy to take questions, or come find me afterward if you want to chat about specific workflows.

---

**Pacing:**
- Slides 01-05 (Opening + framing): ~5 min
- Slides 06-10 (Landscape): ~5 min
- Slides 11-15 (Claude Code deep dive): ~8 min
- Slides 16-19 (Practical workflows): ~7 min
- Slides 20-22 (Turning point + close): ~5 min
