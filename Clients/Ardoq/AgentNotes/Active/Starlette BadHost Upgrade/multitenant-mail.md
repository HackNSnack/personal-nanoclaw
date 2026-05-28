---
tags: [project, starlette-audit, vulnerable, legacy-pin]
type: reference
status: in-progress
---

# multitenant-mail

**Path:** `projects/multitenant-mail/`
**Type:** Email service (FastAPI).

## Internal dependencies
- [[ardoqLogging]] (editable path source)

## Direct external dependencies
- `fastapi==0.115.14` ← **direct, old pin**
- `boto3==1.42.89`, `boto3-stubs[ses, sesv2]==1.42.89`
- `gunicorn==23.0.0`, `uvicorn[standard]==0.24.0.post1`
- `rich==13.9.4`, `toolz==0.12.1`, `tenacity==9.1.4`
- `cryptography==46.0.7`, `rpds-py==0.30.0`

## Starlette exposure
- **starlette `0.46.2`** in `uv.lock` — VULNERABLE (well below 1.0.1).
- Source: direct `fastapi==0.115.14` → `starlette==0.46.2`.
- This is a *much larger* version jump than other projects (0.46 → 1.0). FastAPI 0.115.14's constraint should allow it, but worth verifying the resolution and running the full test suite.

## Risk note
Email service — likely behind a reverse proxy and not directly internet-exposed, but verify ingress posture.

## Action
```bash
cd projects/multitenant-mail
uv lock --upgrade-package starlette
uv sync
moon run multitenant-mail:test
```
If resolution fails, fall back to bumping `fastapi` to a current 0.11x or 0.13x release first.

Back to [[_Index]].
