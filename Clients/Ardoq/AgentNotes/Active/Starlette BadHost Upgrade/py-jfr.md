---
tags: [project, starlette-audit, vulnerable]
type: reference
status: in-progress
---

# py-jfr

**Path:** `projects/py-jfr/`
**Type:** JFR monitoring sidecar (FastAPI).

## Internal dependencies
- [[ardoqAWS]] (editable path source)
- [[ardoqLogging]] (editable path source)

## Direct external dependencies
- `fastapi==0.135.2` ← **direct**
- `uvicorn==0.42.0`
- `apscheduler==3.11.2`, `jpype1==1.7.1`, `kubernetes==35.0.0`
- `rich==14.3.3`, `tenacity==9.1.4`, `toolz==1.1.0`, `typer==0.24.1`, `watchdog==6.0.0`

## Starlette exposure
- **starlette `1.0.0`** in `uv.lock` — VULNERABLE.
- Source: direct `fastapi==0.135.2` → `starlette==1.0.0`.

## Action
```bash
cd projects/py-jfr
uv lock --upgrade-package starlette
uv sync
moon run py-jfr:test
```

Back to [[_Index]].
