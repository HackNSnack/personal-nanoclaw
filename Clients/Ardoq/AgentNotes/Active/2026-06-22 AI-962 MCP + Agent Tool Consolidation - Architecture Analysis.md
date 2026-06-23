---
tags: [ai-962, ai-1286, mcp, consolidation, architecture, design]
type: work
status: in-progress
---

# AI-962 — MCP + Agent Tool Consolidation (Architecture Analysis)

Deep-dive on PR #1103 (AI-962, dashboards slice): can `@ardoq_tool` (chat) and `@dashboard_mcp.tool` + `@track_mcp_tool` (MCP) be consolidated, and if not fully, *where* is the real overlap worth removing? Conclusion: don't consolidate the **tools** (they behave differently by design), consolidate the **scaffolding** around them — transport, request-context, error classification, shaping.

## Problem

MCP and the chat assistant implement the same tools twice. PR #1103 establishes a pattern: extract transport-free **shaping** (`build_dashboard_*_output`) into libs, have both surfaces call it. Question raised: why stop at shaping — can MCP just use the `ardoq_ai` tools directly, providing the run context somehow?

## The two decorator stacks (why full consolidation is impossible)

Each decorator bundles different cross-cutting concerns onto a different runtime contract:

| Concern | `@ardoq_tool` (chat) | `@dashboard_mcp.tool` + `@track_mcp_tool` (MCP) |
|---|---|---|
| Signature | `async (ctx: RunContext[BaseContext], …) -> PydanticModel` | `async (…plain args) -> dict[str, Any]` |
| Dependency injection | *Pushed* via pydantic-ai `RunContext.deps` | *Pulled* from FastMCP contextvar (`get_config_from_request_context`) |
| Transport | libs `ardoq_request`, `User-Agent: ardoq-ai-agents/1.0` | MCP `ardoq_request`, `User-Agent: ardoq-mcp/1.0` + `x-original-real-ip` |
| IP whitelisting | bypassed (trusted internal backend) | enforced (`wrap-ip-whitelisting`) |
| Output | typed model, in-process | JSON envelope + token-budget pagination + notices + web links |
| Error model | `tool_error_handler` → `ModelRetry` / surface | exception → user-friendly response + `ResultStatus` |
| Side effects | invocation cap, registry, feature gating | OTel span + fire-and-forget tracking POST |
| Registration | pydantic-ai `Tool` in `TOOL_REGISTRY` | FastMCP per-domain instance + env tags |

The surface-specific halves (pagination, notices, links, tracking, protocol error codes) genuinely can't merge. So the **tool** can't be one thing.

## Key finding: transport divergence is *mostly configuration*

The PR's stated rationale ("making MCP ride the libs HTTP client would be unsafe") is **overstated**. Evidence from `libs/ardoq_ai/ardoq_ai/api/ardoq_request.py`:

```python
def get_session(authorization, user_agent: str = "ardoq-ai-agents/1.0"):
    headers = {
        "User-Agent": user_agent,        # already a parameter
        "x-org": authorization.org_label,
        "host": authorization.host,
        "x-forwarded-host": authorization.host,
    }
```

The libs client is **already parameterized on `user_agent`** and already sends `x-org`/`host`/`x-forwarded-host`. The security property (whitelisting enforced for MCP, bypassed for chat) is literally two config values:

1. `user_agent` (`ardoq-mcp/1.0` vs `ardoq-ai-agents/1.0`)
2. whether `x-original-real-ip` is attached

So the right axis isn't *transport vs shaping* — it's **request-scoped config (shareable)** vs **surface response-semantics (not)**. `BaseContext` is just request-scoped config; building it from MCP headers vs agent request params is the same operation with different inputs (exactly like `Authorization` already is on both sides).

Why not call `@ardoq_tool` functions directly from MCP? You'd have to (a) un-wrap the pydantic-ai `Tool`, (b) fabricate a `RunContext`, (c) fabricate chat-only `BaseContext` fields. The clean alternative: share a **core** function that sits *below* `RunContext`, operating on a minimal context — no fabrication needed.

## Error handling & the AI-1286 connection

Both surfaces already do **classify → dispose**, with different vocabularies:

- Chat (`tool_error_handler`): catches `ArdoqRequestException` / `ValidationError` / … → `raise ModelRetry` (retriable) or `return message` (surfaced).
- MCP (`exception_handler` + `track_mcp_tool`): catches its own taxonomy → `{error, notice}` + `result_status` + JSON-RPC code.

MCP catches a bespoke taxonomy *only because* it runs its own transport that pre-interprets status codes. Once transport unifies, MCP receives `ArdoqRequestException(status_code, body)` and must deal with it — exactly the premise.

**Three buckets of MCP's current catches:**
- **A — transport-derived (replaceable):** `UnauthorizedException`, `InvalidApiKeyError`, `InvalidIdFormatError`, `BadRequestError`, `UnprocessableContentError`, `NotFoundError` → all status-code interpretations → collapse into `ArdoqRequestException`.
- **B — surface-specific (stays):** `UnsuccessfulResult`, `MetamodelTooLargeError`, `ResponseExceedsTokenLimitException` (token/pagination concerns).
- **C — protocol (stays):** `get_mcp_error_code` JSON-RPC mapping, `result_status` tracking.

**The trap:** MCP must NOT catch `RetriableToolError` / `SurfacedToolError` — those are **chat dispositions** (`RetriableToolError` ⇒ `ModelRetry`, which is meaningless server-side for MCP). MCP should catch the **domain error** and run its own disposition.

**=> This tips the AI-1286 decision toward Approach 1.** Approach 2 (raise `Retriable`/`Surfaced` at the throw site inside the tool) would make the shared core emit chat dispositions that MCP must reverse-map — coupling the shared layer to pydantic-ai semantics. Approach 1 (domain errors flow, handler classifies) lets each surface own its disposition. Cleanest expression: a pure `classify_ardoq_error(exc) -> ErrorCategory` in libs, two disposition tables. This also relocates MCP's `_has_id_in_endpoint_path` / `_has_invalid_token_length` heuristics out of transport into the handler — where Approach 1 says phrasing belongs.

See [[Clients/Ardoq/AgentNotes/Active/2026-06-10 AI-1286 Approach 1 - Domain Errors]] and [[Clients/Ardoq/AgentNotes/Active/2026-06-10 AI-1286 Approach 2 - Raise at Source]].

## The redundancy map — 6 concrete locations

### 0. Search-match predicate — 4 copies of one algorithm
- `projects/ardoq-mcp/src/util.py:284` `search_filter_predicate(name, desc, filter)`
- `libs/.../tools/dashboards/functions.py:13` `_search_filter_match`
- `libs/.../tools/viewpoints/functions.py`, `libs/.../tools/reports/functions.py` (same logic)
- **Action:** one pure `matches_search_filter(name, description, search_filter) -> bool` in libs; delete the rest. Zero risk, fully decoupled.

### 1. Transport — `ardoq_request` ×2
- `libs/.../api/ardoq_request.py` (already `user_agent`-parameterized) vs `projects/ardoq-mcp/src/util.py:122` (~85 lines)
- True deltas: `x-original-real-ip`, base-URL resolution, error taxonomy.
- **Action:** add `extra_headers`/`client_ip` param to libs client; MCP calls libs `ardoq_request(user_agent="ardoq-mcp/1.0", ...)`. Delete MCP's. Security-critical → header-invariant tests required.

### 2. Request context / auth construction
- `projects/ardoq-mcp/src/util.py:204-222` `Config` namedtuple + `get_config_from_headers/request_context` vs `libs/.../api/auth.py` `Authorization` + `libs/.../tools/context.py` `BaseContext`
- **Action:** extract minimal `RequestContext` (auth/base_url/logger/user_agent/client_ip); `BaseContext` extends it. MCP gets `request_context_from_headers()`. Delete `Config`. Prerequisite for #1.

### 3. Error taxonomy (Bucket A)
- Delete 6 classes in `projects/ardoq-mcp/src/config/fastmcp/exceptions/` + `_has_invalid_token_length` / `_has_id_in_endpoint_path` in `util.py`.
- **Action:** MCP catches `ArdoqRequestException`, classifies via shared `classify_ardoq_error` (AI-1286 Approach 1). Keep Buckets B/C.

### 4. Shaping/models — extend the PR pattern
- `projects/ardoq-mcp/src/util.py:236` `filter_keys_in_result_list`/`select_keys_from_dict` (raw-dict), still used by `report_tools.py`, `viewpoint_tools.py`, `restructure_utils.py`.
- **Action:** repeat the dashboard `build_*_output` seam per domain (the epic's existing follow-up list); raw-dict helpers lose callers and die.

### 5. Endpoint strings — drift already paid for
- MCP hardcodes `/api/ai-tools/...` inline; libs centralizes the same paths in `api/*/api.py`. PR #1103 had to migrate `/api/dashboard*` → `/api/ai-tools/dashboards*` *because* they drifted.
- **Action:** falls out of #1+#4 — once MCP rides libs api functions, paths live in one place.

## Sequencing

| Step | What | Deletes | Adds | Depends on |
|---|---|---|---|---|
| A | Dedup search predicate (#0) | 3 copies | 1 fn | — |
| B | `RequestContext` + MCP factory (#2) | `Config` | 1 model + factory | — |
| C | Unify transport (#1) | MCP `ardoq_request` | `extra_headers` param | B |
| D | Shared classifier (#3) | 6 exc + 2 heuristics | 1 classifier | C + AI-1286 Approach 1 |
| E | Per-domain shaping (#4, #5) | raw-dict helpers, hardcoded paths | `build_*` per domain | C |

- **A** is a free win, fully decoupled — ship alone.
- **B→C→D** is the coherent scaffolding unit (transport + config + errors) — mostly deletion, but C/D are on the security-critical path → require header-invariant tests.
- **E** continues the epic's plan on the now-shared rails.

## Decisions / open questions

- **AI-1286: pick Approach 1** if this consolidation is wanted (Approach 2 couples the shared layer to chat retry semantics).
- Classifier granularity: semantic `ErrorCategory` enum vs raw `status_code` switch (weigh against anti-over-abstraction; ~5 categories, 2 consumers).
- `org_label`: does the MCP request context expose it, or only `Host`/`x-org`? Determines whether one `Authorization` covers both surfaces.
- Is the `ardoq-ai-agents/1.0` whitelist bypass a property to rely on long-term, or itself tech debt?

## Related

- [[Clients/Ardoq/AgentNotes/Active/2026-06-10 AI-1286 Approach 1 - Domain Errors]]
- [[Clients/Ardoq/AgentNotes/Active/2026-06-10 AI-1286 Approach 2 - Raise at Source]]
- [[Clients/Ardoq/AgentNotes/Reference/Development/My Code Review Standards]]
- Repo doc: `docs/mcp-agent-tool-consolidation.md` (teammate-facing TL;DR)
