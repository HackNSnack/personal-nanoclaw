# Snippet 006 - Separating Web Search Module

## Date
2025-12-19

## Context
Web search tools (smolagents-based) were originally part of `obsidian_module` but don't belong there conceptually. They should be their own independent module.

## Problem
```
src/obsidian_module/
├── agent_tools.py        # web_search, get_website_contents
├── web_search/
│   ├── agent.py          # Agent class
│   └── sandbox.py
└── tools/                # 13 Obsidian-specific tools
```

Web search has nothing to do with Obsidian - it's a general-purpose capability.

## Solution
Created dedicated `web_search_module`:

```
src/web_search_module/
├── __init__.py           # Exports web_search, get_website_contents
├── tools.py              # Tool functions
└── web_search/
    ├── agent.py          # Agent class (moved)
    └── sandbox.py        # (moved)
```

## Changes Made

### 1. Module Structure
```bash
mkdir src/web_search_module
cp -r src/obsidian_module/web_search src/web_search_module/
cp src/obsidian_module/agent_tools.py src/web_search_module/tools.py
```

### 2. Updated Imports in tools.py
```python
# Before
from src.obsidian_module.web_search.agent import Agent

# After
from src.web_search_module.web_search.agent import Agent
```

### 3. Created __init__.py
```python
from src.web_search_module.tools import get_website_contents, web_search

__all__ = ["web_search", "get_website_contents"]
```

### 4. Updated main.py Registration
```python
# Before
from src.obsidian_module import agent_tools
register_tool(mcp_server, agent_tools.web_search)
register_tool(mcp_server, agent_tools.get_website_contents)

# After
from src.web_search_module import get_website_contents, web_search
register_tool(mcp_server, web_search)
register_tool(mcp_server, get_website_contents)
```

### 5. Cleanup
```bash
rm -rf src/obsidian_module/web_search
rm src/obsidian_module/agent_tools.py
```

## Benefits
1. **Clear separation of concerns** - Obsidian module now only contains Obsidian-specific functionality
2. **Reusability** - Web search module can be used independently
3. **Better organization** - Each module has a single, clear purpose
4. **Consistent pattern** - Follows same structure as other modules

## Module Count
Now have 3 independent modules:
1. `my_module` - Example tools (2 tools)
2. `obsidian_module` - Obsidian integration (13 tools)
3. `web_search_module` - AI web search (2 tools)

Total: 17 tools registered in unified MCP server
