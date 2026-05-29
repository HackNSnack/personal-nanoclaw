---
tags: [project, starlette-audit, vulnerable, legacy-pin]
type: reference
status: in-progress
---

# pac-lite

**Path:** `projects/pac-lite/`
**Type:** Policy as Code (FastAPI).

## Internal dependencies
- [[ardoqLogging]] (editable path source)

## Direct external dependencies
- `fastapi==0.115.14` ← **direct, old pin**
- `gunicorn==23.0.0`
- `uvicorn[standard]==0.24.0.post1`

## Starlette exposure
- **starlette `0.46.2`** in `uv.lock` — VULNERABLE (well below 1.0.1).
- Source: direct `fastapi==0.115.14` → `starlette==0.46.2`.
- Larger jump (0.46 → 1.0) than other projects; verify test suite passes.

## Action
```bash
cd projects/pac-lite
uv lock --upgrade-package starlette
uv sync
moon run pac-lite:test
```
If resolution fails, bump `fastapi` to a current release first. Consider aligning `fastapi` across services (currently `0.115.14`, `0.135.2`, `0.136.0`, `0.136.1` co-exist).

Back to [[_Index]].
