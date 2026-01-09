# EverythingMCP - Unified MCP Server

## Requirements
Create a unified MCP (Model Context Protocol) server that aggregates multiple tool modules into a single HTTP endpoint, using programmatic tool registration pattern.

## Scope
- Centralized FastMCP server with HTTP transport
- Modular tool architecture allowing independent tool modules
- Programmatic tool registration (no decorators in tool definitions)
- Support for multiple tool sources (example tools, Obsidian integration, web search)

## Core Components
1. **FastMCP Server** (`src/server.py`) - Single server instance
2. **Tool Registration** (`src/tool_registration.py`) - Wrapper for programmatic registration
3. **Main Entry Point** (`src/main.py`) - Registers all tools and starts server
4. **Tool Modules** - Independent modules with plain function tools

## Initial Modules
1. **my_module** - Example tools (calculator, string_reverser)
2. **obsidian_module** - Obsidian vault integration (15 tools)
   - File operations (get, list, append, put, patch, delete, batch)
   - Search (simple, complex)
   - Periodic notes (get, get recent)
   - Recent changes
   - Web search tools

## Acceptance Criteria
- [x] Single FastMCP server instance
- [x] Tools defined as plain functions (no decorators)
- [x] Programmatic registration pattern working
- [x] Obsidian module integrated with 15 tools
- [x] Web search tools integrated
- [x] Server runs on HTTP transport (port 8000)
- [x] All imports use absolute paths from `src.*`

## Future Extensions
- Additional tool modules can be added following the same pattern
- Each module remains independent and testable
- Easy to enable/disable modules by commenting out registration calls
