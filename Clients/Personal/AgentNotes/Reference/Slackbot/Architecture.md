---
tags: [slackbot, pydantic-ai, ollama, python]
type: reference
status: current
created: 2026-06-03
---

# Slackbot — Architecture

How the project is structured, what each layer does, and the key design decisions made during the initial build.

---

## Layer overview

```
Slack (Socket Mode)
        │
        ▼
    bot.py                ← AsyncApp event handler, builds AgentDeps, calls agent
        │
        ▼
  chat_agent              ← pydantic-ai Agent (SlackAgent subclass)
        │
        ├── AgentDeps     ← deps injected into every tool: logger, channel, thread_ts
        ├── @instructions ← dynamic system prompt (has access to ctx.deps)
        └── tools=[...]   ← list of @slack_tool-wrapped functions
                │
                ▼
       OpenAIModel (OpenAIProvider → Ollama /v1)
```

---

## Files

### `bot.py` — entry point

Uses `AsyncApp` (not the sync `App`) so agent `.run()` can be awaited directly without threads.

Key flow on every `@mention`:
1. Strips `<@BOT_ID>` tags from the message text
2. Creates a per-request `AgentDeps` with a child logger scoped to the thread timestamp
3. Awaits `chat_agent.run(text, deps=deps)`
4. Posts `result.output` back into the same thread

Error handling is a top-level `try/except` in the handler — any unhandled exception posts a `:x:` message to the thread so the user sees something instead of silence.

### `config.py` — typed settings

Uses `pydantic-settings` `BaseSettings`. Fields are populated from `.env` via `model_validate({})` at module load. The `model_validate({})` pattern avoids a Pyright false-positive that fires when calling `SlackSettings()` directly (Pyright sees required fields as missing constructor args).

Two settings classes:
- `SlackSettings` — `bot_token`, `app_token`
- `OllamaSettings` — `model` (default `llama3`), `base_url` (default `http://localhost:11434`)

### `logger.py` — logging setup

Single call to `setup_logging()` at the top of `bot.py`. All loggers live under the `slackbot.*` namespace. Per-request loggers are created as `slackbot.request.<thread_ts>` so log lines are easy to correlate with threads. Uses stdlib `logging` throughout — no external logging library.

### `agents/base.py` — SlackAgent

Thin subclass of pydantic-ai's `Agent[DepsT, OutputT]`. The only change from the base class is setting `retries=2` as the default. This is the right place to add shared behaviour as the project grows — per-step hooks, cost tracking, run-result logging, etc.

### `agents/chat/agent.py` — the two chat agents

Two `SlackAgent` instances sharing the same model, deps type, and (for now) the same system prompt:

| Agent | Output type | Use when |
|---|---|---|
| `chat_agent` | `str` | You just need the reply text |
| `chat_agent_structured` | `ChatOutput` | You want to log reasoning separately from the Slack reply |

The model is built via `_make_model()` which constructs an `OpenAIModel` pointed at `http://localhost:11434/v1` — Ollama's OpenAI-compatible endpoint. The `api_key="ollama"` value is required by the openai client library but is not validated by Ollama.

System prompts are defined via `@agent.instructions`, which is a decorated async function that receives `ctx: RunContext[AgentDeps]`. This is the right place to inject per-request context (user info, channel name, etc.) once you need it.

### `agents/chat/schema.py` — ChatOutput

```python
class ChatOutput(BaseModel):
    answer: str      # sent to Slack
    reasoning: str   # logged server-side, not shown to user
```

### `tools/context.py` — AgentDeps

The dependencies object injected into every tool via `RunContext[AgentDeps]`. Access via `ctx.deps.<field>` inside any tool function.

```python
class AgentDeps(BaseModel):
    logger: Any       # logging.Logger for this request
    channel: str      # Slack channel ID
    thread_ts: str    # Slack thread timestamp
```

Frozen (`ConfigDict(frozen=True)`) to prevent accidental mutation across tool calls.

### `tools/tool_decorator.py` — @slack_tool

Wraps an async tool function with two layers and returns a pydantic-ai `Tool`:

```
_error_handler          ← outermost: converts unexpected exceptions to ModelRetry
    └── _logging_wrapper    ← logs start, duration, success/failure
            └── original tool function
```

The `_error_handler` re-raises `ModelRetry` untouched (pydantic-ai's own retry signal), converts everything else to `ModelRetry` so the model is told to try again rather than seeing a raw Python exception.

The `_logging_wrapper` measures wall-clock duration and logs payload size (serialised kwargs bytes) at DEBUG on entry, INFO on success, WARNING on failure.

Can be used with or without arguments:
```python
@slack_tool
async def my_tool(ctx: RunContext[AgentDeps], arg: str) -> str:
    """Docstring becomes the tool description shown to the model."""
    ...

@slack_tool(timeout=30.0)
async def slow_tool(ctx: RunContext[AgentDeps]) -> str:
    """Override any Tool() constructor kwarg."""
    ...
```

---

## Key design decisions

### Why AsyncApp instead of sync App + threads?

The original skeleton used `threading.Thread` to avoid blocking the Slack handler while Ollama ran. With pydantic-ai's async API it is cleaner to go fully async from the top — `AsyncApp` + `AsyncSocketModeHandler` + `await agent.run(...)`. This also makes future async tool calls (HTTP requests, file I/O, etc.) natural.

### Why `model_validate({})` for settings?

`SlackSettings()` causes Pyright to report `Arguments missing for parameters 'bot_token', 'app_token'` because Pyright sees required fields as required constructor args. `BaseSettings.model_validate({})` goes through the same env-loading pipeline but is typed as accepting `Any`, so Pyright is satisfied. The behaviour is identical.

### Why no global TOOL_REGISTRY?

ardoq_ai's `TOOL_REGISTRY` + `register_all_tools()` exists to support spec-driven dynamic agent building (assembling agents from DB config at runtime). This project has hardcoded agents, so tools are imported directly by each agent file. The registry can be added later if needed.

### Why no `__init__.py` files?

Python 3.3+ namespace packages allow `from agents.chat.agent import chat_agent` to work without `__init__.py` as long as `src/` is on `sys.path`. Running `python src/bot.py` adds `src/` to `sys.path[0]` automatically, so all absolute imports resolve. Avoids the boilerplate of empty init files.

### Prompt injection defence

If you ever inject user-controlled content (Slack message text, usernames, etc.) directly into a system prompt, wrap it with XML data tags to signal to the model that it is reference data, not instructions:

```python
def wrap_in_data_tag(value: Any, tag: str) -> str:
    return f"<data:{tag}>\n{value}\n</data:{tag}>"

# e.g.
f"The user said: {wrap_in_data_tag(user_text, 'user-message')}"
```

This is a pattern from `ardoq_ai/utils/prompt_utils.py` that was not ported across (too small to warrant a file) but is worth keeping in mind.
