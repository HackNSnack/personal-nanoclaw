# Personal - Index

Map of Content for Personal development notes.

## Active Work

- [[Clients/Personal/AgentNotes/Active/2026-06-11 NanoClaw OpenCode Provider Setup]] — Full OpenCode+OpenRouter debug session: model ID format, bundled registry bypass, OneCLI bearer sentinel, wirings→destinations bug fix (status: **done** ✅)
- [[Clients/Personal/AgentNotes/Active/2026-05-29 Pi OpenRouter Config & Model Skill]] — Tasks 1.1 (pi config) + 1.2 (model skill)


## Key Decisions

<!-- Important decisions for reference -->

## Reference

<!-- Evergreen patterns and knowledge -->

### NanoClaw (current Slack bot)

- [[Clients/Personal/AgentNotes/Reference/NanoClaw/NanoClaw NixOS Setup]] — Full NixOS deployment reference (current status, bootstrap checklist, secrets layout)
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/NanoClaw Operations]] — Quick-reference runbook: start/stop, logs, common fixes
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/Slack Channel Setup & Debugging]] — Socket mode setup, four-layer failure diagnosis, `agent_destinations` wiring bug fix, portability notes
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/OpenCode + OpenRouter Configuration]] — Full architecture: OneCLI bearer sentinel, model ID format, bundled model list workaround, new-machine checklist
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/OpenCode ProviderModelNotFoundError — Stale Session Loop]] — `Error: Model not found` runbook
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/DeepSeek Missing Closing Tag — Silent Response Drop]] — Agent responses silently dropped when DeepSeek omits closing message tag on long outputs: full investigation log, SSE race root cause, two fixes applied: three root causes (bundled list, missing prefix, stale session) + diagnostic playbook + code changes applied

### Slackbot (superseded — old Python/Ollama bot)

- [[Clients/Personal/AgentNotes/Reference/Slackbot/_Index]] — Full reference index
- [[Clients/Personal/AgentNotes/Reference/Slackbot/Architecture]] — Code structure, layers, design decisions
- [[Clients/Personal/AgentNotes/Reference/Slackbot/Extending]] — Adding tools, agents, thread history

### OpenRouter + Pi

- [[Clients/Personal/AgentNotes/Reference/OpenRouter/_Index]] — Full reference index
- [[Clients/Personal/AgentNotes/Reference/OpenRouter/00 - Overview]] — What it is, why, pricing, privacy
- [[Clients/Personal/AgentNotes/Reference/OpenRouter/01 - Routing Mechanism]] — Provider & model routing controls
- [[Clients/Personal/AgentNotes/Reference/OpenRouter/02 - Providers]] — Whitelist/blacklist, geography, retention policies
- [[Clients/Personal/AgentNotes/Reference/OpenRouter/03 - Models & Pricing]] — Recommended models, cost comparison
- [[Clients/Personal/AgentNotes/Reference/OpenRouter/04 - Pi Integration]] — Full `models.json` config reference
- [[Clients/Personal/AgentNotes/Reference/OpenRouter/05 - Work vs Personal Setup]] — Two-level settings, switching

### Hyprland Config (KoolDots)

- [[Clients/Personal/AgentNotes/Reference/Hyprland/KoolDots Keybind Override — ChangeLayout Runtime Clobber]] — Why `SUPER+HJKL` overrides in `UserKeybinds.conf` were silently overwritten at startup: two `exec-once` scripts (`ChangeLayout.sh init`, `KeybindsLayoutInit.sh`) used `hyprctl keyword` to clobber J/K after config parsing. Includes full git archaeology of both scripts, the static-vs-runtime bind phase distinction, and the fix applied (stripped J/K lines from `ChangeLayout.sh`, deleted `KeybindsLayoutInit.sh`).

### NixOS Config (NixOS-Hyprland)

- [[Clients/Personal/AgentNotes/Reference/NixOS/Debugging nixpkgs Evaluation Warnings & Insecure Packages]] — How to trace renamed packages, catppuccin migration, pnpm node override, and hunting down transitive `nodejs-slim_20` via `nix eval` + flake.lock analysis
- [[Clients/Personal/AgentNotes/Reference/NixOS/Replacing Source-Built Packages with Pre-Built Binaries]] — Step-by-step guide for swapping source-compiled packages with pre-built binaries or AppImages via overlays; includes moon as worked example (bambu-studio moved to Flatpak)
- [[Clients/Personal/AgentNotes/Reference/NixOS/Declarative Flatpak with nix-flatpak]] — When to use Flatpak instead of overlays; nix-flatpak setup, bambu-studio migration, adding more apps declaratively

## PiDev Reference Links

### Architecture (Source Code Analysis)

- [[Clients/Personal/AgentNotes/Reference/PiDev/Architecture/00 - Categories Overview]] — Documentation plan & monorepo overview
- [[Clients/Personal/AgentNotes/Reference/PiDev/Architecture/01 - Monorepo Structure & Bootstrap]] — Package layout, CLI, startup
- [[Clients/Personal/AgentNotes/Reference/PiDev/Architecture/02 - AI Provider Layer]] — LLM providers, streaming, models
- [[Clients/Personal/AgentNotes/Reference/PiDev/Architecture/03 - Agent Core]] — Low-level agent loop, tool execution
- [[Clients/Personal/AgentNotes/Reference/PiDev/Architecture/04 - Agent Session & Conversation Loop]] — Session abstraction, prompting
- [[Clients/Personal/AgentNotes/Reference/PiDev/Architecture/05 - Tool System]] — Built-in tools, tool definitions
- [[Clients/Personal/AgentNotes/Reference/PiDev/Architecture/06 - Extension System]] — Extension API, events, loader, runner
- [[Clients/Personal/AgentNotes/Reference/PiDev/Architecture/07 - Session Management & Branching]] — JSONL persistence, tree
- [[Clients/Personal/AgentNotes/Reference/PiDev/Architecture/08 - Compaction & Context Management]] — Compaction, summarization
- [[Clients/Personal/AgentNotes/Reference/PiDev/Architecture/09 - System Prompt & Context Files]] — Prompt assembly, AGENTS.md
- [[Clients/Personal/AgentNotes/Reference/PiDev/Architecture/10 - Modes & UI Layer]] — Interactive, print, RPC modes
- [[Clients/Personal/AgentNotes/Reference/PiDev/Architecture/11 - Skills, Prompts & Resources]] — Skills, templates, themes
- [[Clients/Personal/AgentNotes/Reference/PiDev/Architecture/12 - Model Registry & Resolution]] — Model discovery, providers

### Extension Development

- [[Clients/Personal/AgentNotes/Reference/PiDev/Overview]] — Pi.dev architecture and philosophy
- [[Clients/Personal/AgentNotes/Reference/PiDev/Permission System]] — Custom permission extension (3-tier prompting, sensitive files)
- [[Clients/Personal/AgentNotes/Reference/PiDev/Subagent Extension]] — Subagent delegation tool, known bugs & fixes
- [[Clients/Personal/AgentNotes/Reference/PiDev/Status Bar Extension]] — custom footer (branch, model, context bar, cwd, thinking level)
- [[Clients/Personal/AgentNotes/Reference/PiDev/Configuration]] — Config file structure and git tracking setup

### Documentation

- [[Clients/Personal/AgentNotes/Reference/PiDev/Documentation/Pi Documentation Index - LLM Reference]] — Doc file quick lookup
- [[Clients/Personal/AgentNotes/Reference/PiDev/Documentation/Pi Coding Agent - Full Documentation]] — Complete feature docs

### Travel

- [[Clients/Personal/AgentNotes/Reference/SAS Travels/SAS EuroBonus & SkyTeam Analysis]] — SkyTeam routes to Asia/Japan/NZ, EuroBonus award chart, point costs, feasibility for fully points-funded trip.
- [[Clients/Personal/AgentNotes/Reference/SAS Travels/Grocery Store Price Comparison with EuroBonus]] — Effective price comparison across Kiwi, Coop, Rema 1000 with Trumf + Amex stacking.
