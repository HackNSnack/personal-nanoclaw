---
tags: [library, starlette-audit, vulnerable]
type: reference
status: in-progress
---

# ardoq_ai

**Path:** `libs/ardoq_ai/`
**Type:** Core shared library — agents, tools, API clients. Hub of the AI services architecture.

## Internal dependencies
- [[ardoqLogging]] (editable path source)
- [[ardoq_tracing]] (editable path source)

## Used by (downstream)
[[ai_agents]], [[ai-agents-sandbox-runtime]], [[ai-web-agent-sandbox-runtime]], [[ai_observability]], [[ardoq-mcp]]

## Notable runtime dependencies
- `fastapi==0.136.1` ← **direct, pinned**
- `pydantic-ai-slim[duckduckgo,anthropic,evals,openai,spec]==1.87.0`
- `pydantic==2.12.5`
- `aiohttp==3.13.4`
- `polars==1.40.1`
- `docker==7.1.0`
- `deepeval==3.8.8`
- `k8s-agent-sandbox[async]` (git pin)
- `trafilatura==2.0.0`
- `pydantic-settings==2.13.1`

## Starlette exposure

- **starlette `1.0.0`** in `uv.lock` — VULNERABLE to CVE-2026-48710 (BadHost).
- Brought in by: `fastapi==0.136.1` (direct dependency, declared in `pyproject.toml`).
- FastAPI 0.136.1's starlette constraint is `starlette>=0.46.0` (no upper bound), so a `uv lock --upgrade-package starlette` will resolve to `1.0.1`+ without touching FastAPI.

## Action
```bash
cd libs/ardoq_ai
uv lock --upgrade-package starlette
uv sync
moon run ardoq_ai:test
```
Then re-lock every downstream project that path-depends on `ardoq_ai`.

Back to [[_Index]].
