---
tags: [project, starlette-audit, vulnerable]
type: reference
status: in-progress
---

# ai-agents-sandbox-runtime

**Path:** `projects/ai-agents-sandbox-runtime/`
**Type:** Sandbox runtime for AI agents.

## Internal dependencies
- [[ardoq_ai]] (editable path source)
- [[ardoqLogging]] (editable path source)

## Direct external dependencies
- `uvicorn==0.44.0`
- `python-multipart==0.0.27`

## Starlette exposure
- **starlette `1.0.0`** in `uv.lock` — VULNERABLE.
- Path: [[ardoq_ai]] → `fastapi==0.136.1` → `starlette==1.0.0`.

## Action
Upgrade [[ardoq_ai]] first, then `uv lock --upgrade-package starlette` here.

Back to [[_Index]].
