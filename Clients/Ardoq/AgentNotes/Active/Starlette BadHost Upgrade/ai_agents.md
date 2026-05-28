---
tags: [project, starlette-audit, vulnerable]
type: reference
status: in-progress
---

# ai_agents

**Path:** `projects/ai_agents/`
**Type:** Main AI backend service (FastAPI on port 8000).

## Internal dependencies
- [[ardoq_ai]] (editable path source)
- [[ardoqLogging]] (editable path source, transitive via `ardoq_ai`)
- [[ardoq_tracing]] (editable path source, transitive via `ardoq_ai`)

## Direct external dependencies
- `uvicorn==0.44.0`

*(No direct `fastapi` — FastAPI is brought in transitively through [[ardoq_ai]].)*

## Starlette exposure
- **starlette `1.0.0`** in `uv.lock` — VULNERABLE.
- Path: [[ardoq_ai]] → `fastapi==0.136.1` → `starlette==1.0.0`.
- Only source of starlette in this project.

## Action
Upgrade [[ardoq_ai]] first, then:
```bash
cd projects/ai_agents
uv lock --upgrade-package starlette
uv sync
moon run ai_agents:test
```

Back to [[_Index]].
