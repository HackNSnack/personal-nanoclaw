# Snippet 005 - Web Search Tool Refactoring

## Date
2025-12-19

## Challenge
`agent_tools.py` contained decorator-based tools that needed conversion:
- `web_search` - AI-powered search using smolagents
- `get_website_contents` - URL fetching and processing

Original code:
```python
from src.server import app as http_app
from src.web_search.agent import Agent

agent = Agent()  # Module-level instantiation

@http_app.tool()
def web_search(query: str) -> Any:
    return agent.run_search_agent(repr(query))
```

## Solution
Applied singleton pattern:

```python
from src.obsidian_module.web_search.agent import Agent

_agent = None

def get_agent() -> Agent:
    global _agent
    if _agent is None:
        _agent = Agent()
    return _agent

def web_search(query: str) -> Any:
    """
    Performs an intelligent, sandboxed web search using an AI agent.
    """
    query_escaped = repr(query)
    agent = get_agent()
    return agent.run_search_agent(query_escaped)

def get_website_contents(url: str) -> Any:
    """
    Performs a GET request to a specific URL and returns its contents.
    """
    try:
        agent = get_agent()
        return agent.search_url_and_filter(url)
    except Exception as e:
        return f"GET request on URL {url} failed: {e}"
```

## Key Difference
Agent initialization is expensive (Docker container setup), so singleton pattern is crucial here for performance.

## Registration
```python
# src/main.py
from src.obsidian_module import agent_tools

register_tool(mcp_server, agent_tools.web_search)
register_tool(mcp_server, agent_tools.get_website_contents)
```
