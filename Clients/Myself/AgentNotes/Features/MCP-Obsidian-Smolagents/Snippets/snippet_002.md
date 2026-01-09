# Snippet 002: Repository Changes Analysis

**Date:** 2025-12-18

## Restructuring

**Old Structure:**
```
src/mcp_obsidian/
├── __init__.py
├── obsidian.py
├── server.py
└── tools.py
```

**New Structure:**
```
src/
├── __init__.py
├── agent_tools.py         # NEW: MCP tool wrappers
├── main.py
├── obsidian.py
├── server.py
├── tools/                 # Modularized tools
│   ├── __init__.py
│   ├── list_files_in_vault.py
│   ├── get_file_contents.py
│   ├── simple_search.py
│   └── [other tools...]
└── web_search/           # NEW: Agent capabilities
    ├── agent.py          # Agent class
    └── sandbox.py        # Docker sandbox management
```

## New Dependencies

Added to `pyproject.toml`:
```toml
"docker>=7.1.0",
"smolagents[litellm]>=1.23.0",
"ddgs>=9.10.0",
"websocket-client>=1.9.0",
"beautifulsoup4>=4.14.3",
```

## Key Files Modified

- `pyproject.toml` - Dependencies and project metadata updated
- Git status shows old `mcp_obsidian/` files deleted
- New flat `src/` structure created
