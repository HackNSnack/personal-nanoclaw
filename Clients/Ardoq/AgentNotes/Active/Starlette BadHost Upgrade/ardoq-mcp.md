---
tags: [project, starlette-audit, vulnerable]
type: reference
status: in-progress
---

# ardoq-mcp

**Path:** `projects/ardoq-mcp/`
**Type:** MCP server for Ardoq API access (port 8000).

## Internal dependencies
- [[ardoq_ai]] (editable path source)
- [[ardoqLogging]] (editable path source)
- [[ardoq_tracing]] (editable path source)

## Direct external dependencies
- `gunicorn==23.0.0`
- `uvicorn[standard]==0.44.0`
- `httpx==0.28.1`
- `fastmcp==3.2.0`
- `tiktoken==0.12.0`

## Starlette exposure

**starlette `1.0.0`** in `uv.lock` — VULNERABLE. Multiple inbound paths:

| Path | Notes |
|---|---|
| direct `fastmcp==3.2.0` → `mcp==1.27.1` → `starlette` | The MCP SDK uses Starlette for its HTTP transport |
| direct `fastmcp==3.2.0` → `sse-starlette==3.4.4` → `starlette` | SSE transport |
| [[ardoq_ai]] → `fastapi==0.136.1` → `starlette` | Inherited |

All converge on the same `starlette==1.0.0` entry, so a single bump fixes all paths.

## Risk note
MCP server transports HTTP — the BadHost bypass is directly relevant if any path-based auth/middleware reads `request.url.path`.

## Action
Upgrade [[ardoq_ai]] first, then `uv lock --upgrade-package starlette` here. Verify `fastmcp`/`mcp`/`sse-starlette` accept starlette 1.0.1.

Back to [[_Index]].
