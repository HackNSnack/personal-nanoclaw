---
tags: [project, starlette-audit, vulnerable]
type: reference
status: in-progress
---

# ai_observability

**Path:** `projects/ai_observability/`
**Type:** LLM output evaluation service.

## Internal dependencies
- [[ardoq_ai]] (editable path source)
- [[ardoqLogging]] (editable path source — listed in `[tool.uv.sources]`)
- [[ardoq_tracing]] (editable path source — listed in `[tool.uv.sources]`)

## Direct external dependencies
- `litellm==1.83.0`
- `pydantic-ai-slim[evals,openai,mcp]==1.87.0`

## Starlette exposure
- **starlette `1.0.0`** in `uv.lock` — VULNERABLE.
- Sources of starlette:
  - [[ardoq_ai]] → `fastapi==0.136.1`
  - `pydantic-ai-slim[mcp]==1.87.0` → `mcp==1.27.0` → `starlette`
  - `pydantic-ai-slim[mcp]==1.87.0` → `sse-starlette==3.4.1` → `starlette`
- All resolve to the single `starlette==1.0.0` in the lockfile, so one bump fixes them all.

## Action
Upgrade [[ardoq_ai]] first, then `uv lock --upgrade-package starlette` here. Verify `mcp` / `sse-starlette` accept starlette 1.0.1.

Back to [[_Index]].
