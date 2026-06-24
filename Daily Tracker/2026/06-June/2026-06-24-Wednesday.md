# Wednesday, June 24, 2026

<< [[Daily Tracker/2026/06-June/2026-06-23-Tuesday| |Yesterday]] | [[Daily Tracker/2026/06-June/2026-06-24-Wednesday||Today]] | [[Daily Tracker/2026/06-June/2026-06-25-Thursday|Tomorrow]] >>


---
### ❇️ Daily Tasks

##### 🚀 Things I plan to accomplish today is...
- [ ] Continued discussion on David Negley's PR to add `AND`-logic to feature flags, discussing whether this is something we want to allow
- [ ] Resolved git merge conflicts rebasing NixOS desktop branch onto main (flake.lock, NVIDIA/CUDA/Ollama config, packages)
- [ ] Investigated Jason's issues with apprat agent, looking at potential FE timeout issues + awake-pings from BE
- [ ] Meeting w/Nifemi, Alf, Adrienn, Isaac to go through changes w.r.t. wrapping FE/TypeScript functions in JSON schemas, passing them to Python & parsing them as tools, then emitting that (tool) event which gets parsed by the FE to then execute said TypeScript functions
- [ ] AI scoping meeting
- [ ] Did deep-dive into how we can add CI workflows that check for changes (in Clojure and Python respectively) w.r.t. schemas, and failing if an update happened to a schema that wasn't properly handled (e.g. Clojure has new schemas, but Python hasn't re-generated its models)
- [ ] Started working on AI-1408: Schema codegen script (CLJ)
- [ ] Started working on AI-1410: Model gen scripts + moon tasks (Python / monorepo)
- [ ] Opened PR #1210 for AI-1410: Add sync_models.sh for local-schema-based model generation — https://github.com/ardoq/devops-monorepo/pull/1210
- [ ] Opened PR #18540 for AI-1408: Schema codegen script (CLJ) — https://github.com/ardoq/ardoq-api/pull/18540


---
## ⛔ Blockers


---
# 📝 Notes


---
### Notes created today
```dataview
List FROM "" WHERE file.cday = date("2026-06-24") SORT file.ctime asc
```

### Notes last touched today
```dataview
List FROM "" WHERE file.mday = date("2026-06-24") SORT file.mtime asc
```