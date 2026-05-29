---
tags: [project, starlette-audit, not-affected]
type: reference
status: done
---

# backup

**Path:** `projects/backup/`
**Type:** Database backup tooling (CLI, not an HTTP service).

## Internal dependencies
- [[ardoqLogging]] (editable path source)

## Direct external dependencies
- `click==8.3.1`, `requests==2.33.0`, `tenacity==9.1.4`, `psycopg==3.3.3`, `python-pmap==2.0.0`
- OpenTelemetry api/sdk/exporter/instrumentation `1.40.0` / `0.61b0`

## Starlette exposure
**None.** No `fastapi`/`starlette` in `pyproject.toml` or `uv.lock`. CLI / OTel only.

Back to [[_Index]].
