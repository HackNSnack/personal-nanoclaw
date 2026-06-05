---
tags: [slackbot, pydantic-ai, ollama, python]
type: reference
status: current
created: 2026-06-03
---

# Slackbot — Extending

How to add tools, add new agents, and other common growth paths.

---

## Adding a tool

### 1. Create the tool file

Create `src/tools/<domain>/functions.py`. Tools are standalone async functions — they are not attached to any specific agent at definition time, so the same tool can be reused across multiple agents.

```python
# src/tools/weather/functions.py

from pydantic_ai import RunContext

from tools.context import AgentDeps
from tools.tool_decorator import slack_tool


@slack_tool
async def get_weather(ctx: RunContext[AgentDeps], city: str) -> str:
    """Get the current weather for a city.

    Returns a short plain-text summary of current conditions.
    Use this when the user asks about the weather somewhere.
    """
    # ctx.deps.logger, ctx.deps.channel, ctx.deps.thread_ts are all available
    ...
```

The docstring becomes the tool description the model sees — write it from the model's perspective (when to call it, what it returns).

### 2. Add it to an agent's tools list

Open `src/agents/chat/agent.py` (or the relevant agent file) and add the import + list entry:

```python
from tools.weather.functions import get_weather

chat_agent = SlackAgent(
    name="chat_agent",
    deps_type=AgentDeps,
    output_type=str,
    model=_make_model(),
    tools=[get_weather],          # add here
)
```

### 3. Extend AgentDeps if the tool needs new dependencies

If the tool needs something that isn't already in `AgentDeps` (e.g. an HTTP client, an API key), add a field to `AgentDeps` in `src/tools/context.py`:

```python
class AgentDeps(BaseModel):
    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)
    logger: Any
    channel: str
    thread_ts: str
    weather_api_key: str   # new field
```

Then pass it when building deps in `bot.py`:

```python
deps = AgentDeps(
    logger=request_log,
    channel=channel,
    thread_ts=thread_ts,
    weather_api_key=settings.weather_api_key,
)
```

---

## Adding a new agent

### 1. Create the agent directory

```
src/agents/<name>/
    agent.py      # agent instance(s) + @instructions
    schema.py     # output schema, if using structured output
```

### 2. Define the agent

Follow the pattern in `src/agents/chat/agent.py`:

```python
# src/agents/<name>/agent.py

from pydantic_ai import RunContext
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.openai import OpenAIProvider

from agents.base import SlackAgent
from config import ollama_settings
from tools.context import AgentDeps
from tools.some_domain.functions import some_tool


def _make_model() -> OpenAIModel:
    return OpenAIModel(
        ollama_settings.model,
        provider=OpenAIProvider(
            base_url=f"{ollama_settings.base_url}/v1",
            api_key="ollama",
        ),
    )


my_agent = SlackAgent(
    name="my_agent",
    deps_type=AgentDeps,
    output_type=str,
    model=_make_model(),
    tools=[some_tool],
)


@my_agent.instructions
async def _instructions(ctx: RunContext[AgentDeps]) -> str:
    return "You are a ..."
```

### 3. Wire it into bot.py

Import the new agent and decide how to route to it (e.g. keyword in the message, different Slack channel, slash command):

```python
from agents.chat.agent import chat_agent
from agents.my_agent.agent import my_agent

@app.event("app_mention")
async def handle_mention(event: dict, say) -> None:
    text = re.sub(r"<@\w+>", "", event.get("text", "")).strip()
    agent = my_agent if text.startswith("/research") else chat_agent
    result = await agent.run(text, deps=deps)
    await say(result.output, thread_ts=thread_ts)
```

---

## Switching to structured output

Swap `chat_agent` for `chat_agent_structured` in `bot.py`. The output is a `ChatOutput(answer, reasoning)` — send `answer` to Slack and log `reasoning` server-side:

```python
from agents.chat.agent import chat_agent_structured

result = await chat_agent_structured.run(text, deps=deps)
_log.debug("reasoning [%s]: %s", thread_ts, result.output.reasoning)
await say(result.output.answer, thread_ts=thread_ts)
```

---

## Adding Slack thread history

Currently the bot only sees the current message. To give it full thread context, fetch prior messages from Slack and pass them as `message_history` to `agent.run()`.

pydantic-ai uses `list[ModelMessage]` from `pydantic_ai.messages` for history. The simplest approach is to build a prior-turn history from the Slack thread:

```python
from pydantic_ai.messages import ModelRequest, ModelResponse, UserPromptPart, TextPart

async def build_message_history(
    client, channel: str, thread_ts: str, bot_user_id: str, current_ts: str
) -> list:
    result = await client.conversations_replies(channel=channel, ts=thread_ts)
    history = []
    for msg in result["messages"]:
        # Skip the current message — it becomes the user_prompt argument
        if msg["ts"] == current_ts:
            continue
        text = re.sub(r"<@\w+>", "", msg.get("text", "")).strip()
        if not text:
            continue
        is_bot = msg.get("user") == bot_user_id or msg.get("bot_id") is not None
        if is_bot:
            history.append(ModelResponse(parts=[TextPart(text)]))
        else:
            history.append(ModelRequest(parts=[UserPromptPart(text)]))
    return history
```

Then pass it to `run()`:

```python
history = await build_message_history(client, channel, thread_ts, bot_user_id, event["ts"])
result = await chat_agent.run(text, deps=deps, message_history=history)
```

Note: `client.auth_test()` gives you `bot_user_id` to distinguish bot messages from user messages.

---

## Changing the model

Update `OLLAMA_MODEL` in `.env` to any model you have pulled locally:

```bash
ollama pull mistral
# then in .env:
OLLAMA_MODEL=mistral
```

To use a different model per agent (e.g. a faster model for simple tasks, a smarter one for complex tasks), pass a different `OllamaSettings.model` value when building the model in each agent file, or add a per-agent env var.
