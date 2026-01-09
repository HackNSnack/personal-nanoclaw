# Architecture - EverythingMCP

## Design Decisions

### 1. Programmatic Tool Registration Pattern
**Decision**: Use wrapper function instead of decorators for tool registration

**Approach**:
```python
# server.py
mcp_server = FastMCP()

# tool_registration.py
def register_tool(server: FastMCP, tool: Callable) -> None:
    server.tool()(tool)

# tools defined as plain functions
def calculator(x: int, y: int, operation: str = "add") -> int:
    # implementation
    pass

# main.py
def register_all():
    register_tool(mcp_server, calculator)
```

**Benefits**:
- Tools completely decoupled from server
- Tools are testable plain functions
- Modules can be imported without side effects
- Clear separation of concerns

### 2. Singleton Resource Pattern
**Decision**: Use singleton pattern for shared resources (API clients, agents)

**Implementation**:
```python
# client.py
_obsidian_client = None

def get_obsidian_client() -> Obsidian:
    global _obsidian_client
    if _obsidian_client is None:
        api_key = os.getenv("OBSIDIAN_API_KEY", "")
        obsidian_host = os.getenv("OBSIDIAN_HOST", "127.0.0.1")
        _obsidian_client = Obsidian(api_key=api_key, host=obsidian_host)
    return _obsidian_client
```

**Benefits**:
- Single client instance across all tools
- Lazy initialization only when needed
- Environment variables loaded once
- Resource efficient

### 3. Absolute Import Paths
**Decision**: Use absolute imports from `src.*` instead of relative imports

**Pattern**: `from src.obsidian_module.client import get_obsidian_client`

**Benefits**:
- Clear module boundaries
- Easier to understand dependencies
- No relative import confusion
- Works consistently across different execution contexts

### 4. Module Organization
**Structure**:
```
src/
├── server.py              # Single FastMCP instance
├── tool_registration.py   # Registration wrapper
├── main.py               # Entry point, registers all tools
├── my_module/            # Example module
│   └── tools.py
└── obsidian_module/      # Obsidian integration
    ├── __init__.py       # Exports tools
    ├── client.py         # Singleton client
    ├── obsidian.py       # API wrapper
    ├── agent_tools.py    # Web search tools
    ├── tools/            # 13 Obsidian tools
    └── web_search/       # Agent implementation
```

**Pattern for new modules**:
1. Create module directory
2. Define tools as plain functions
3. Create shared resources with singletons if needed
4. Export tools via `__init__.py`
5. Register in `main.py`

## Technology Stack
- **FastMCP** - MCP server framework
- **FastAPI** - HTTP application framework
- **Uvicorn** - ASGI server
- **requests** - HTTP client for Obsidian API
- **smolagents** - AI agent framework for web search
- **Docker** - Execution sandbox for web search agents

## Transport
- **HTTP Streamable** on path `/mcp`
- Port 8000 (configurable)
- FastAPI app mounts MCP server

## Key Insights
1. Decorators are syntactic sugar - can be called as functions
2. `@mcp.tool()` is equivalent to `mcp.tool()(function)`
3. This enables programmatic registration while keeping tools pure
4. Registration happens only at `if __name__ == "__main__"` to prevent duplicate registration
