# Slackbot — Reference Index

Evergreen reference for the local Slack bot backed by Ollama + pydantic-ai, running in Socket Mode on the local desktop. No public exposure needed — the bot dials out to Slack via a WebSocket.

**Repo:** `~/Prosjekter/Personal/Slackbot`

---

## Documents

1. [[Clients/Personal/AgentNotes/Reference/Slackbot/Architecture]] — Code structure, layer responsibilities, design decisions, how pydantic-ai wires to Ollama
2. [[Clients/Personal/AgentNotes/Reference/Slackbot/Extending]] — Adding tools, adding agents, switching to structured output, thread history

---

## Quick Reference

### Run

```bash
cd ~/Prosjekter/Personal/Slackbot
nix-shell shell.nix        # or activate env
uv run python src/bot.py
```

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SLACK_BOT_TOKEN` | ✅ | — | Bot OAuth token (`xoxb-…`) |
| `SLACK_APP_TOKEN` | ✅ | — | Socket Mode app token (`xapp-…`) |
| `OLLAMA_MODEL` | | `llama3` | Model name passed to Ollama |
| `OLLAMA_BASE_URL` | | `http://localhost:11434` | Ollama server base URL |

### File structure

```
src/
├── bot.py                     # Entry point — Slack event handler
├── config.py                  # Typed settings (pydantic-settings)
├── logger.py                  # Stdlib logging setup
├── agents/
│   ├── base.py                # SlackAgent — thin Agent subclass
│   └── chat/
│       ├── agent.py           # chat_agent (str) + chat_agent_structured
│       └── schema.py          # ChatOutput(answer, reasoning)
└── tools/
    ├── context.py             # AgentDeps — injected into every tool
    └── tool_decorator.py      # @slack_tool — logging + error handling
```

### Key dependencies

| Package | Version | Role |
|---|---|---|
| `pydantic-ai-slim[openai]` | `1.87.0` | Agent framework, tool wiring |
| `slack-bolt` | `1.28.0` | Slack Socket Mode + async event handler |
| `pydantic-settings` | `>=2.0` | Typed env-var config |
| `aiohttp` | `>=3.11` | Required by `AsyncApp` |

### Design origin

Structure adapted from `ardoq_ai` (internal project). The `SlackAgent`, `@slack_tool`, `AgentDeps`, and per-agent module pattern all mirror the ardoq approach — stripped of Ardoq-specific concerns (feature flags, LiteLLM routing, guardrails, OTEL tracing, pipeline).
