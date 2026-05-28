---
tags: [project, starlette-audit, vulnerable]
type: reference
status: in-progress
---

# swarm

**Path:** `projects/swarm/`
**Type:** Investigative agent swarm for incident/error/anomaly analysis (FastAPI).

## Internal dependencies
- [[ardoqAWS]] (editable path source)
- [[ardoqLogging]] (editable path source)

## Direct external dependencies (selected)
- `fastapi==0.136.0` ← **direct**
- `pydantic-ai==1.83.0`
- `pydantic-ai-backend==0.2.4`
- `claude-agent-sdk==0.1.59`
- `httpx==0.28.1`
- `elasticsearch==8.19.3`
- `slack-bolt==1.28.0`
- `sentry-sdk==2.58.0`
- OpenTelemetry stack (`1.39.1` / `0.60b1`) — note: lags behind [[ardoq_tracing]]'s `1.40.0` / `0.61b0`.

## Starlette exposure
- **starlette `1.0.0`** in `uv.lock` — VULNERABLE. Multiple inbound paths:
  - direct `fastapi==0.136.0` → `starlette`
  - `pydantic-ai==1.83.0` → `pydantic-ai-slim==1.83.0` → `starlette`
  - transitive `mcp==1.26.0` → `starlette`
  - transitive `sse-starlette==3.3.4` → `starlette`
- All converge on `starlette==1.0.0`; single bump fixes all.

## Action
```bash
cd projects/swarm
uv lock --upgrade-package starlette
uv sync
moon run swarm:test
```

Back to [[_Index]].
