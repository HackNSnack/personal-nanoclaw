---
tags: [library, starlette-audit]
type: reference
status: in-progress
---

# ardoq_tracing

**Path:** `libs/ardoq_tracing/`
**Type:** Library (leaf)

## Internal dependencies
None.

## Used by
[[ardoq_ai]], [[ai_observability]], [[ardoq-mcp]]

*(Note: an unrelated `libs/ardoqTracing/` directory exists with only `tests/` — appears to be legacy/dead. The active library is `ardoq_tracing`.)*

## Runtime dependencies
- `opentelemetry-api==1.40.0`
- `opentelemetry-sdk==1.40.0`
- `opentelemetry-exporter-otlp==1.40.0`
- `opentelemetry-instrumentation==0.61b0`
- `opentelemetry-instrumentation-fastapi==0.61b0`
- `opentelemetry-instrumentation-requests==0.61b0`
- `opentelemetry-instrumentation-urllib==0.61b0`
- `opentelemetry-instrumentation-httpx==0.61b0`
- `opentelemetry-instrumentation-aiohttp-client==0.61b0`

## Starlette exposure

**Runtime:** None directly. `opentelemetry-instrumentation-fastapi` (no `[instruments]` extra) does not pull `fastapi`/`starlette` itself; it only instruments them if present in the host app.

**Dev group:** `opentelemetry-instrumentation-fastapi[instruments]==0.61b0` is in `[dependency-groups].dev` and pulls `fastapi==0.136.1` → `starlette==1.0.0` into the lockfile.

→ **Verdict: dev-only test exposure**, not shipped. Bump on next routine relock.

Back to [[_Index]].
