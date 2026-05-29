---
tags:
  - security
  - starlette
  - fastapi
  - cve
type: work
status: done
---

# Starlette BadHost (CVE-2026-48710) — Monorepo Upgrade Map

> **Goal:** Determine whether we can upgrade every starlette package across `~/Prosjekter/Netlight/Ardoq/worktrees/monorepo1` to `>= 1.0.1` to remediate the BadHost host-header auth-bypass vulnerability.

## The vulnerability (one-paragraph recap)

Starlette reconstructs `request.url` by concatenating the `Host` header with the request path and re-parsing the result, without validating the `Host` value. A `Host` header containing `/`, `?`, or `#` shifts the path/query/fragment boundaries on re-parse, so `request.url.path` no longer matches the path the ASGI server actually routed against. **Any middleware that makes path-based security decisions using `request.url.path` (instead of `request.scope["path"]`) can be bypassed.** Affected: `starlette >= 0.8.3, < 1.0.1`. Fixed in **starlette 1.0.1**.

Sources: [OSTIF disclosure](https://ostif.org/disclosing-the-badhost-vulnerability-in-starlette/), [GHSA-86qp-5c8j-p5mr](https://github.com/Kludex/starlette/security/advisories/GHSA-86qp-5c8j-p5mr), [badhost.org](https://badhost.org/).

## Good news — the upgrade is mechanically trivial

FastAPI's own dependency on starlette is loosely pinned (`starlette>=0.46.0`, no upper bound). FastAPI maintainers confirmed in [discussion #15593](https://github.com/fastapi/fastapi/discussions/15593) that any FastAPI on starlette ≤ 1.0.0 is exposed. **We do not need to bump FastAPI** — we only need to bump starlette to 1.0.1 in each project's lockfile (`uv lock --upgrade-package starlette`). For `multitenant-mail` and `pac-lite`, which currently resolve to `starlette 0.46.2`, the same `uv lock` upgrade applies; verify behaviour because that's a much larger version jump.

## Internal dependency graph (open Graph View to visualise)

### Libraries (in `libs/`)
- [[ardoqLogging]] — leaf, no internal deps
- [[ardoqAWS]] — leaf, no internal deps
- [[ardoq_tracing]] — leaf, no internal deps
- [[ardoq_ai]] — depends on [[ardoqLogging]], [[ardoq_tracing]]

### Projects (in `projects/`)
- [[ai_agents]] → [[ardoq_ai]]
- [[ai-agents-sandbox-runtime]] → [[ardoq_ai]], [[ardoqLogging]]
- [[ai-web-agent-sandbox-runtime]] → [[ardoq_ai]], [[ardoqLogging]]
- [[ai_observability]] → [[ardoq_ai]], [[ardoqLogging]], [[ardoq_tracing]]
- [[ardoq-mcp]] → [[ardoq_ai]], [[ardoqLogging]], [[ardoq_tracing]]
- [[backup]] → [[ardoqLogging]]
- [[multitenant-mail]] → [[ardoqLogging]]
- [[pac-lite]] → [[ardoqLogging]]
- [[py-jfr]] → [[ardoqAWS]], [[ardoqLogging]]
- [[starboard-to-jira]] → [[ardoqLogging]]
- [[swarm]] → [[ardoqAWS]], [[ardoqLogging]]
- [[waf-autoupdate]] → [[ardoqLogging]]

## Starlette exposure summary

| Project / Lib | Currently resolves | Brought in via | Vulnerable? | Upgrade action |
|---|---|---|---|---|
| [[ardoq_ai]] | `1.0.0` | direct `fastapi==0.136.1` | ✅ yes | `uv lock --upgrade-package starlette` |
| [[ardoq_tracing]] | `1.0.0` (dev only) | dev-group `opentelemetry-instrumentation-fastapi[instruments]==0.61b0` → fastapi | ⚠️ dev-only, not runtime | bump in dev lockfile when convenient |
| [[ardoqLogging]] | — | — | ❌ no | none |
| [[ardoqAWS]] | — | — | ❌ no | none |
| [[ai_agents]] | `1.0.0` | [[ardoq_ai]] → `fastapi==0.136.1` | ✅ yes | `uv lock --upgrade-package starlette` |
| [[ai-agents-sandbox-runtime]] | `1.0.0` | [[ardoq_ai]] → `fastapi==0.136.1` | ✅ yes | `uv lock --upgrade-package starlette` |
| [[ai-web-agent-sandbox-runtime]] | `1.0.0` | [[ardoq_ai]] → `fastapi==0.136.1` | ✅ yes | `uv lock --upgrade-package starlette` |
| [[ai_observability]] | `1.0.0` | [[ardoq_ai]] → `fastapi==0.136.1`, plus `mcp==1.27.0`, `sse-starlette==3.4.1` (via `pydantic-ai-slim[mcp]`) | ✅ yes | `uv lock --upgrade-package starlette` |
| [[ardoq-mcp]] | `1.0.0` | direct `fastmcp==3.2.0` (→ `mcp==1.27.1`, `sse-starlette==3.4.4`) **and** [[ardoq_ai]] → `fastapi==0.136.1` | ✅ yes | `uv lock --upgrade-package starlette` |
| [[multitenant-mail]] | **`0.46.2`** | direct `fastapi==0.115.14` | ✅ yes (old) | `uv lock --upgrade-package starlette` — verify, larger jump |
| [[pac-lite]] | **`0.46.2`** | direct `fastapi==0.115.14` | ✅ yes (old) | `uv lock --upgrade-package starlette` — verify, larger jump |
| [[py-jfr]] | `1.0.0` | direct `fastapi==0.135.2` | ✅ yes | `uv lock --upgrade-package starlette` |
| [[swarm]] | `1.0.0` | direct `fastapi==0.136.0`, plus `mcp==1.26.0`, `sse-starlette==3.3.4`, `pydantic-ai-slim==1.83.0` | ✅ yes | `uv lock --upgrade-package starlette` |
| [[backup]] | — | — | ❌ no | none |
| [[starboard-to-jira]] | — | — | ❌ no | none |
| [[waf-autoupdate]] | — | — | ❌ no | none |

## Suggested remediation order

1. **`libs/ardoq_ai`** first — it is the dependency hub for 5 projects. Bumping its lockfile validates the FastAPI/starlette combo once.
2. **Downstream consumers** of `ardoq_ai` (re-lock to pick up the new transitive): `ai_agents`, `ai-agents-sandbox-runtime`, `ai-web-agent-sandbox-runtime`, `ai_observability`, `ardoq-mcp`.
3. **Independent FastAPI services**: `py-jfr`, `swarm`.
4. **Older FastAPI services** (extra QA): `multitenant-mail`, `pac-lite` — they still ship `starlette 0.46.x`; consider bumping FastAPI to a more recent 0.11x/0.13x while we're touching them.
5. **`libs/ardoq_tracing`** — dev-group only; lowest priority.

## Defence-in-depth (recommended regardless of upgrade)

- Replace any use of `request.url` / `request.url.path` in middleware/auth/audit code with `request.scope["path"]`. Worth grepping the codebase.
- Confirm that the reverse proxy in front of every ASGI service rejects malformed `Host` headers (nginx/Cloudflare reject the PoC by default — verify config).

## Status
- [x] Map dependencies
- [x] Identify starlette sources per project
- [ ] Execute upgrades (out of scope for this note)
- [ ] Grep codebase for `request.url.path` usage in middleware (recommended follow-up)
