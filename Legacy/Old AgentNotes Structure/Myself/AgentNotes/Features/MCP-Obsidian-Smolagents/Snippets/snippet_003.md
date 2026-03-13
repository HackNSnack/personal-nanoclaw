# Snippet 003: Agent Implementation Details

**Date:** 2025-12-18

## Agent Class (src/web_search/agent.py)

### Configuration
Uses LiteLLM for model flexibility:
```python
class Agent:
    def __init__(self):
        self.litellm_api_key = os.getenv("LITELLM_API_KEY")
        self.litellm_api_base = os.getenv("LITELLM_API_BASE")
        self.litellm_model = os.getenv("LITELLM_MODEL")
        self.model = LiteLLMModel(
            model_id=self.litellm_model,
            api_base=self.litellm_api_base,
            api_key=self.litellm_api_key,
        )
```

**Required Environment Variables:**
- `LITELLM_API_KEY`
- `LITELLM_API_BASE`
- `LITELLM_MODEL`

### Web Search Method

```python
def run_search_agent(self, search_query: str):
    with CodeAgent(
        tools=[DuckDuckGoSearchTool()],
        model=self.model,
        max_steps=5,  # Safety guard
        executor_type="docker",
        stream_outputs=False,
    ) as agent:
        result = agent.run(search_query)
        return result
```

**Key Parameters:**
- `tools`: List containing `DuckDuckGoSearchTool()`
- `max_steps=5`: Limits execution steps for safety
- `executor_type="docker"`: Uses Docker for isolation
- `stream_outputs=False`: Returns final result only

### URL Content Fetcher

```python
def search_url_and_filter(self, search_url: str):
    with CodeAgent(
        tools=[],
        model=self.model,
        max_steps=10,
        executor_type="docker",
        stream_outputs=False,
        additional_authorized_imports=["bs4", "requests"],
    ) as agent:
        agent_task = (
            f"Your task is to perform a GET request on the following URL: {search_url}. "
            "Subsequently, you should make this more LLM-friendly by removing all HTML-specific info. "
            "This includes using bs4 to remove all HTML tags."
        )
        result = agent.run(agent_task)
        return result
```

**Key Differences:**
- No tools provided (agent generates code)
- `max_steps=10`: More complex task needs more steps
- `additional_authorized_imports`: Allows bs4 and requests
- Task description guides code generation
