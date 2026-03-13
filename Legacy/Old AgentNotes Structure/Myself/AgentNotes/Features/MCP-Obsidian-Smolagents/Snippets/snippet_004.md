# Snippet 004: MCP Tool Wrappers

**Date:** 2025-12-18

## Tool Registration (src/agent_tools.py)

### Web Search Tool

```python
@http_app.tool()
def web_search(query: str) -> Any:
    """
    Performs an intelligent, sandboxed web search using an AI agent.
    Use for complex questions requiring research and synthesis.

    Args:
        query: The research question or search query.

    Returns:
        A string containing the AI-processed search results.
    """
    query_escaped = repr(query)
    return agent.run_search_agent(query_escaped)
```

**Purpose:**
- Exposes smolagents web search capability as MCP tool
- Handles complex research queries
- Returns synthesized results

**Security Note:**
- Uses `repr()` to safely escape query string

### URL Content Fetcher

```python
@http_app.tool()
def get_website_contents(url: str) -> Any:
    """
    Performs a GET request to a specific URL and returns its contents
    directly. use to fetch direct contents of a known URL.

    Args:
        url: The URL to fetch content from

    Returns:
        A bytestring containing the contents of the webpage
    """
    try:
        return agent.search_url_and_filter(url)
    except Exception as e:
        return f"GET request on URL {url} failed: {e}"
```

**Purpose:**
- Fetches and cleans web content
- Removes HTML tags for LLM consumption
- Error handling for failed requests

## Tool Initialization

```python
agent = Agent()  # Single instance for all tool calls
```

Agent instance created at module level for reuse across tool invocations.
