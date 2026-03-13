# Common Patterns

Recurring solutions, code patterns, and best practices observed across projects.

## Patterns

*(To be populated as patterns emerge)*


## Programmatic Tool Registration in FastMCP

### Pattern Overview
Method for registering MCP tools programmatically without using decorators directly in submodules. Enables modular tool organization and prevents duplicate registration.

### Implementation

**Core Components:**
1. **`src/server.py`** - Single FastMCP server instance
2. **`src/tool_registration.py`** - Wrapper function `register_tool(server, tool)`
3. **`src/my_module/tools.py`** - Plain functions with proper docstrings/type hints
4. **`src/main.py`** - Orchestration with `register_all()` function

**Key Pattern:**
```python
def register_tool(server: FastMCP, tool: Callable) -> None:
    server.tool()(tool)
```

Works because decorators are syntactic sugar - `@server.tool()` ≡ `server.tool()(function)`

### Architecture

**Tool Registration Flow:**
1. Tools defined as plain functions in submodules (no decorators)
2. Tools imported in `main.py`
3. `register_all()` function calls `register_tool()` for each tool
4. `register_all()` only invoked when `main.py` runs directly (`if __name__ == "__main__"`)
5. Prevents duplicate registration when module imported elsewhere

**Benefits:**
- **Modularity** - Tools live in separate submodules
- **No decorator coupling** - Tools are plain functions
- **Controlled registration** - Single point of registration prevents duplicates
- **Scalability** - Easy to add new tool modules

### Usage Example

```python
# src/my_module/tools.py
def calculator(x: int, y: int, operation: str = "add") -> int:
    """Perform basic arithmetic operations."""
    # implementation
    
# src/main.py
def register_all():
    register_tool(mcp_server, calculator)
    register_tool(mcp_server, string_reverser)

if __name__ == "__main__":
    register_all()  # Only when directly executed
```

### Date
2025-12-19
