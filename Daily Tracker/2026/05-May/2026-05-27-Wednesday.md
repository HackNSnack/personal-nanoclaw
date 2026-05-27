# Wednesday, May 27, 2026

<< [[Daily Tracker/2026/05-May/2026-05-26-Tuesday| |Yesterday]] | [[Daily Tracker/2026/05-May/2026-05-27-Wednesday||Today]] | [[Daily Tracker/2026/05-May/2026-05-28-Thursday|Tomorrow]] >>


---
### ❇️ Daily Tasks

##### 🚀 Things I plan to accomplish today is...
- [ ] Did substantial review of Alf's PR on capping tool invocations. Went back & forth on whether we should only implement for `get_neighbors_data` tool, or general cap through `ardoq_tool`. Concluded with the latter
- [ ] Reviewed devops-PR on using shared tracing lib
- [ ] Started working on AI-1225
- [ ] Debugged `pi update` self-update failure — traced root cause to `pnpm install -g` respecting the global lockfile (0.74.0 pinned), fixed `getUpdateInstruction` in `config.ts` to use `pnpm add -g @pkg@latest`, identified same bug in `getSelfUpdateCommandForMethod` in installed dist
- [ ] AI scoping session, discussing omnipresent assistant + custom agents, gathering all we need for Gartner
- [ ] Looked into production errors with title generation, figured it was dangling error from 401 JWT Python PR using wrong CLJ endpoint (probably old pod not being updated yet)
- [ ] Got wedding gift!🥰
- [ ] 1-on-1 with Falco, confirming that I can work from Trondheim a while, and that my contract is likely to be extended!
- [ ] Investigated moon + NixOS venv issue — root cause: proto WASM plugins resolve to versioned binary paths ignoring `.prototools`; fix is to reinstall proto tools and use `--no-actions` to skip `SyncProject`'s `uv venv` call, relying on `VIRTUAL_ENV` env var already in path
- [ ] Fixed moon not loading `.env` for `LITE_LLM_API_KEY` — root cause: hot-reload task runs `hot_reload.py` (not `main.py`), and Moon pre-populates placeholder into env so `load_dotenv()` needs `override=True` + explicit project-root path. Packaged as gitignored `monkeypatch/dotenv-local/` with apply/revert scripts
- [ ] Reviewed Nifemi's/Claudette's PR on hot reload, asking whether we need new commands, or can just package hot-reload into existing run command
- [ ] Implemented AI-1225: removed hardcoded tool docs from ardoq_assistant system prompt (233 lines), relying on Pydantic AI native tool descriptions + existing prepare_tools hook in ArdoqAgent
	- [ ] Created PR for the changes
- [ ] Started working on AI-1189: Consolidate ArdoqAgentSpecV1 into CustomAgent — remove intermediate spec model
- [ ] Started work on cleaning up hot-reload, favouring a config variable in moon.yml files rather than individual python files + env vars
- [ ] Made Claudette "absorb" removed system prompt instructions into corresponding tool descriptions
- [ ] Consolidated hot-reload into `run` task across `ai_agents`, `ai_observability`, `ardoq-mcp` via optional `HOT_RELOAD` env var; removed standalone `hot_reload.py` scripts and moved ardoq-mcp `setup()` into FastAPI lifespan so reload workers initialise. Opened draft PR #1001 targeting `hot-reload-dev-servers`
- [ ] 


---
## ⛔ Blockers


---
# 📝 Notes

Tomorrow's work:
- Continue on consolidation of spec, which will lie the foundation for file-based custom agents

---
### Notes created today
```dataview
List FROM "" WHERE file.cday = date("2026-05-27") SORT file.ctime asc
```

### Notes last touched today
```dataview
List FROM "" WHERE file.mday = date("2026-05-27") SORT file.mtime asc
```