# Wednesday, July 01, 2026

<< [[Daily Tracker/2026/06-June/2026-06-30-Tuesday| |Yesterday]] | [[Daily Tracker/2026/07-July/2026-07-01-Wednesday||Today]] | [[Daily Tracker/2026/07-July/2026-07-02-Thursday|Tomorrow]] >>


---
### ❇️ Daily Tasks

##### 🚀 Things I plan to accomplish today is...
- [ ] Merged CI PR on Python-side
- [ ] Merged CI PR on clojure side
- [ ] Approved Adri's PR on error-handling timeout
- [ ] Implemented tool-output guardrail capability in ardoq_ai (pydantic-ai after_tool_execute hook + LiteLLM apply_guardrail, no Clojure round-trip)
- [ ] Reached out to Nifemi + Adrienn on how to safeguard against prompt injection (PI) when ingesting data through tools, suggesting a general tool-wrapper that would intercept the tool results and check for PI before passing it to the agent
- [ ] Fixed treesitter crash on K/hover by migrating nvim-treesitter to main branch
	- [ ] Added tree-sitter CLI package to NixOS-Hyprland flake for parser builds
- [ ] Started working on AI-1400: Investigate how to validate content consumed by AI to not contain e.g. prompt injection
- [ ] Fixed 297 pyright typecheck errors in ardoq_ai (stale tool_definitions.py import path after refactor to ardoq_tool/schema.py)
- [ ] Continued work on guardrailing tools, leading to a full implementation suggestion. Made PR and awaiting review from Nifemi + Adri
- [ ] Fixed import errors in guardrail-PR
- [ ] Long-stretched AI scoping meeting, discussing e.g. web search & custom agents
- [ ] Meeting w/Koffe to discuss issues and personal challenges around Netlight & motivation
- [ ] Discussion w/Nifemi + Adri regarding use of capabilities & grouping of tools
- [ ] Long discussion thread w/Nifemi, Adri; jason, Mario regarding whether a CA should fail if one of its tools is gated behind FF
- [ ] 


---
## ⛔ Blockers


---
# 📝 Notes


---
### Notes created today
```dataview
List FROM "" WHERE file.cday = date("2026-07-01") SORT file.ctime asc
```

### Notes last touched today
```dataview
List FROM "" WHERE file.mday = date("2026-07-01") SORT file.mtime asc
```