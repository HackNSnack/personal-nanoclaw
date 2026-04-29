# Wednesday, April 29, 2026

<< [[Daily Tracker/2026/04-April/2026-04-28-Tuesday| |Yesterday]] | [[Daily Tracker/2026/04-April/2026-04-29-Wednesday||Today]] | [[Daily Tracker/2026/04-April/2026-04-30-Thursday|Tomorrow]] >>

---

### ❇️ Daily Tasks

##### 🚀 Things I plan to accomplish today is...

- [x] Reviewed and rewrote multi-turn metric guide to clarify callback contract and custom evaluator options
- [x] Archived 3 Ardoq active notes and synced \_Index.md
- [x] Created AI-1095: Implement custom agent invocation endpoint in Clojure API
- [x] Opened PR #790: Add Pi.dev files to .gitignore
- [x] Made Claudette add [PR](https://github.com/ardoq/ardoq-api/pull/17271) for invoking custom agent endpoints in Clojure
- [x] Addressed PR #709 review: collect streaming events into CompletionSuccess/CompletionFailure
- [x] Code review and refactor of AI-1095 PR for better code reuse in chat_service.clj
- [x] Fixed local pi.dev tooling permission error that allowed 1 "allow" to count for 2 operations in a row
- [x] Delivery Coach (DC) sync w/Kristoffer (Koffe)
- [x] Analysed AI-1080 Malli/codegen gap; created AI-1100 (Clojure Malli schema), updated AI-1080 description, created AI-1101 (Python custom agent endpoints)
- [x] AI-1100: Add ArdoqAgentSpec + ArdoqModelSettings Malli schemas to schemas.clj; updated ticket description, branch ready for PR
- [x] Discussed output-schema validation strategy: (A) schema-as-stored validation via jsonschema.check_schema in Python at invocation time (AI-1101); (B) post-LLM response validation against output-schema as separate ticket; Malli :map type intentionally left loose
- [x] Discussed w/Adrienn Ardoq agent specs, ensuring we're on the same page;
	- [x] Pushed validation down the line; for Gartner demo, we ensure ourselves that the specs work, but do no validation
	- [x] Future validation will depend on e.g. versioned tools & specs, in case we make changes
- [x] Made Claudette do improvements to `CLAUDE.md` to improve test writing
- [x] Resolved git merge conflicts in Helm charts and streaming.py (imports + execute_agent/span_update)
- [x] Updated PRD for custom agents with clarifications on validation of the spec

---

## ⛔ Blockers

---

# 📝 Notes

---

### Notes created today

```dataview
List FROM "" WHERE file.cday = date("2026-04-29") SORT file.ctime asc
```

### Notes last touched today

```dataview
List FROM "" WHERE file.mday = date("2026-04-29") SORT file.mtime asc
```
