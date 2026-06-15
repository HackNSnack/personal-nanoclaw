# Skills Reference

## Container Skills (loaded at runtime in NanoClaw)

Available to Claudette via the `skill` tool:

| Skill | Purpose |
|-------|---------|
| `agent-browser` | Web navigation, element interaction, screenshots, PDFs, cookies |
| `frontend-engineer` | Frontend build-test-verify discipline |
| `onecli-gateway` | Credential proxy for external APIs |
| `self-customize` | Agent self-modification (packages, MCP servers, code) |
| `slack-formatting` | Slack mrkdwn formatting |
| `vercel-cli` | Vercel deployment |
| `welcome` | Channel onboarding |
| `whatsapp-formatting` | WhatsApp formatting with phone-number mentions |

Source: `nanoclaw-fork/container/skills/`

---

## NanoClaw-Fork Operational Skills (platform maintenance)

On `main` in `.claude/skills/` at `nanoclaw-fork`. Instructions for maintaining the nanoclaw platform:

| Skill | Purpose |
|-------|---------|
| `setup` | First-time fork/clone setup |
| `debug` | Debugging nanoclaw issues |
| `update-nanoclaw` | Core update via git merge |
| `customize` | Post-setup additions |
| `update-skills` | Check for skill branch updates |
| `init-first-agent` | Bootstrap first agent |
| `init-onecli` | OneCLI gateway init |
| `manage-channels` | Channel wiring |
| `manage-mounts` | Mount configuration |

## NanoClaw-Fork Feature Skills (channel integrations)

Skill-branch based (`skill/*` branches). For adding channels/providers:

`add-discord`, `add-telegram`, `add-slack`, `add-gmail`, `add-gchat`, `add-whatsapp`, `add-whatsapp-cloud`, `add-signal`, `add-matrix`, `add-teams`, `add-webex`, `add-wechat`, `add-imessage`, `add-deltachat`, `add-linear`, `add-gcal-tool`, `add-github`, `add-ollama-tool`, `add-ollama-provider`, `add-vercel`, `add-opencode`, `add-codex`, `add-atomic-chat-tool`, `add-dashboard`, `add-emacs`, `add-karpathy-llm-wiki`, `add-macos-statusbar`, `add-mnemon`, `add-resend`, `add-rtk`, `migrate-from-openclaw`, `migrate-from-v1`, `migrate-nanoclaw`, `use-native-credential-proxy`, `get-qodo-rules`, `qodo-pr-resolver`, `convert-to-apple-container`

Source: `nanoclaw-fork/.claude/skills/` and `nanoclaw-fork/.pi/skills/`

---

## Pi-Config Skills (pi.dev agent)

At `.pi-config/agent/skills/`. For pi.dev, not NanoClaw, but vault management patterns may be reusable:

**Vault-reusable**: `add-daily-entry`, `archive-note`, `clean-index`, `link-note`, `load-context`, `new-client`, `note-decision`, `reference-note`, `search-notes`, `workflow-reference`

**Pi.dev-specific**: `create-jira-issue`, `create-pr`, `review-pr`, `solve-issue`, `start-issue`, `check-duplicate-jira-issue`, `animate`, `layout`, `new-deck`, `new-slide`, `outline`, `review-deck`, `story`, `ext-adopt`, `ext-execute`, `ext-sync`, `pidev-context`, `prompt-engineer`, `recommend-model`, `resolve-conflicts`, `skill-builder`, `update-model-config`, `weekly-report`, `worktree`

**Vendored**: `librarian` (pi-web-access) — open-source library research with permalinks
