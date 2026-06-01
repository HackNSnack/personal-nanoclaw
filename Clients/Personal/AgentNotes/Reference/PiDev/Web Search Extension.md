---
tags:
  - pidev
  - extensions
  - web-search
  - curator
type: reference
status: current
created: 2026-07-14T00:00:00.000Z
---

# Web Search Extension

Vendored extension providing web search, content fetching, GitHub cloning, YouTube/video analysis, and an interactive result curator. Adopted from `nicobailon/pi-web-access` v0.10.7 with local modifications.

**Location:** `~/.pi/agent/extensions/vendored/pi-web-access/`  
**Upstream:** `github.com/nicobailon/pi-web-access` @ `076bf0d`  
**Provenance:** `~/.pi/agent/extensions/vendored/.provenance.json`

---

## Tools Registered

| Tool | Purpose |
|------|---------|
| `web_search` | Multi-provider web search (Exa, Perplexity, Gemini). Returns synthesised answer + source citations. Supports single `query` or batched `queries`. |
| `code_search` | Code examples, docs, and API references via Exa MCP. No key required in zero-config mode. |
| `fetch_content` | Fetch URL(s) as markdown. Handles GitHub repos (clone), YouTube (Gemini transcript), local video, PDFs, blocked pages. |
| `get_search_content` | Retrieve stored full content from a previous `web_search` or `fetch_content` call by `responseId`. |

### `web_search` Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string? | Single query |
| `queries` | string[]? | Batch of queries (prefer this — 2–4 varied angles) |
| `numResults` | number? | Results per query (default 5, max 20) |
| `recencyFilter` | `day\|week\|month\|year`? | Recency filter |
| `domainFilter` | string[]? | Limit/exclude domains (prefix `-` to exclude) |
| `provider` | `auto\|exa\|perplexity\|gemini`? | Force a provider (default: auto) |
| `workflow` | `none\|summary-review`? | Skip curator (`none`) or open it (`summary-review`, default) |
| `summaryModel` | string? | **Custom addition** — override the curator's summariser model for this call. Format: `provider/model-id` (e.g. `"anthropic/claude-haiku-4-5"`). Must be in the model registry with an API key. |
| `includeContent` | boolean? | Fetch full page content from sources in background |

> `summaryModel` was added locally (not in upstream). It overrides `defaultSummaryModel` in `PendingCurate`, pre-selecting that model in the curator dropdown.

---

## The Curator

The curator is an **interactive browser tab** that intercepts `web_search` results before they reach the LLM. It lets you review, filter, and shape what the model sees.

### Flow

```
agent calls web_search({ queries: [...] })
  │
  ├─ extension spins up local HTTP server
  ├─ opens browser tab (or Glimpse window on macOS)
  ├─ streams query results into the tab via SSE as they arrive
  │
  │  [You interact in the browser]
  │  ├─ keep or discard individual query results
  │  ├─ add extra ad-hoc searches
  │  ├─ select a summariser model from dropdown
  │  ├─ click "Summarize" → AI generates a draft summary
  │  └─ edit the draft, then click "Send"
  │
  └─ only the approved results/summary are injected into agent context
```

### Timeout

Default 20 s of idle. Configurable via `curatorTimeoutSeconds` in `~/.pi/web-search.json` (max 600). On timeout, auto-submits everything and falls back to a deterministic (non-AI) summary if no approved draft exists.

### Workflow Modes

| Mode | Behaviour |
|------|-----------|
| `summary-review` (default) | Opens curator, auto-generates AI summary draft |
| `none` | Skips curator entirely — results go straight to LLM |

Toggle at runtime with `/curator`. Persisted to `~/.pi/web-search.json`.

---

## Slash Commands

Slash commands run directly against the live session — no LLM turn, no token cost.

| Command | Usage | What it does |
|---------|-------|---------------|
| `/websearch` | `/websearch [q1, q2, ...]` | Opens the curator browser directly (bypasses agent). Pre-fills comma-separated queries. Results injected as a follow-up message that triggers an agent turn. |
| `/curator` | `/curator [on\|off\|summary-review\|none]` | Toggles or sets the default curator workflow. No arg = toggle. Persists to `~/.pi/web-search.json`. |
| `/google-account` | `/google-account` | Shows which Google account is authenticated for Gemini Web (useful with multiple Chrome profiles). |
| `/search` | `/search` | Interactive browser of stored `responseId` results from the current session. View or delete entries. |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+S` | Open curator for the current pending search (if one is in progress) |
| `Ctrl+Shift+W` | Toggle the web activity monitor widget (shows live request/response log) |

Both are configurable under `shortcuts` in `~/.pi/web-search.json`.

---

## Provider Fallback Chain

```
web_search (auto mode)
  → Exa (direct API if exaApiKey set, else MCP proxy)
  → Perplexity (if perplexityApiKey set)
  → Gemini API (if geminiApiKey set)
  → Gemini Web (if allowBrowserCookies: true)

fetch_content
  → GitHub URL?  clone repo locally (gh CLI for private)
  → YouTube URL? Gemini Web → Gemini API → Perplexity
  → Local video? Gemini API Files → Gemini Web
  → HTTP URL:    Readability → RSC parser → Jina Reader → Gemini URL Context
  → PDF?         text-extract → ~/Downloads/<name>.md
```

---

## Configuration (`~/.pi/web-search.json`)

```json
{
  "exaApiKey": "exa-...",
  "perplexityApiKey": "pplx-...",
  "geminiApiKey": "AIza...",
  "provider": "exa",
  "workflow": "summary-review",
  "summaryModel": "anthropic/claude-haiku-4-5",
  "curatorTimeoutSeconds": 20,
  "allowBrowserCookies": false,
  "chromeProfile": "Profile 2",
  "searchModel": "gemini-2.5-flash",
  "shortcuts": {
    "curate": "ctrl+shift+s",
    "activity": "ctrl+shift+w"
  },
  "githubClone": {
    "enabled": true,
    "maxRepoSizeMB": 350,
    "cloneTimeoutSeconds": 30,
    "clonePath": "/tmp/pi-github-repos"
  },
  "youtube": { "enabled": true, "preferredModel": "gemini-3-flash-preview" },
  "video": { "enabled": true, "preferredModel": "gemini-3-flash-preview", "maxSizeMB": 50 }
}
```

Env vars `EXA_API_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY` take precedence over file values.

---

## File Structure

```
~/.pi/agent/extensions/vendored/pi-web-access/
├── index.ts              # Entry point — all 4 tools, 5 commands, 2 shortcuts
├── exa.ts                # Exa search provider (direct API + MCP proxy)
├── extract.ts            # URL/file routing, HTTP extraction, fallback orchestration
├── gemini-search.ts      # Multi-provider search routing
├── gemini-api.ts         # Gemini REST API client
├── gemini-web.ts         # Gemini Web client (cookie auth, StreamGenerate)
├── gemini-url-context.ts # Gemini URL Context + Web extraction fallbacks
├── gemini-web-config.ts  # Browser-cookie opt-in config
├── curator-server.ts     # Ephemeral SSE HTTP server for curator UI
├── curator-page.ts       # Curator browser HTML/CSS/JS
├── summary-review.ts     # Summary prompt, AI draft generation, deterministic fallback
├── youtube-extract.ts    # YouTube detection + three-tier extraction
├── video-extract.ts      # Local video analysis via Gemini Files API
├── github-extract.ts     # GitHub clone cache + content generation
├── github-api.ts         # GitHub API fallback (large repos, commit SHAs)
├── perplexity.ts         # Perplexity API client (rate-limited: 10 req/min)
├── code-search.ts        # Code/docs search via Exa MCP
├── chrome-cookies.ts     # macOS/Linux Chromium cookie extraction
├── pdf-extract.ts        # PDF text extraction → ~/Downloads/<name>.md
├── rsc-extract.ts        # Next.js RSC flight data parser
├── storage.ts            # Session-aware responseId storage
├── activity.ts           # Activity tracking for the Ctrl+Shift+W widget
├── utils.ts              # Shared helpers
├── skills/librarian/     # Bundled research skill for open-source library investigation
└── package.json          # 5 npm deps: @mozilla/readability, linkedom, p-limit, turndown, unpdf
```

---

## Adoption Notes (Local Changes vs Upstream)

Adopted via **selective copy** — all files taken from upstream, with these changes:

| File | Change |
|------|--------|
| `index.ts` | `@mariozechner/pi-{coding-agent,tui,ai}` → `@earendil-works/` ; `"typebox"` → `"@sinclair/typebox"` (Pi virtual module name) |
| `index.ts` | Added `summaryModel` tool parameter (see above) |
| `storage.ts` | `@mariozechner/pi-coding-agent` → `@earendil-works/pi-coding-agent` |
| `summary-review.ts` | `@mariozechner/pi-{ai,coding-agent}` → `@earendil-works/` |
| `index.ts` | Two empty `catch {}` blocks annotated with comments (linter) |

> **Why the namespace change?** Upstream was written against the old `@mariozechner/` package names. Pi's virtual module system (used in Bun binary mode) only injects the `@earendil-works/` variants. Pi provides these at runtime — they don't appear in `package.json`.

---

## Bundled Skill: `librarian`

Located at `skills/librarian/SKILL.md`. A research workflow for investigating open-source libraries — combines GitHub cloning, web search, and git operations (blame, log, show) to produce evidence-backed answers with permalinks. Pi auto-loads it based on prompt context.

---

## Related

- [[Clients/Personal/AgentNotes/Reference/PiDev/Overview]] — pi.dev architecture overview
- [[Clients/Personal/AgentNotes/Reference/PiDev/Subagent Extension]] — the other main vendored extension
- [[Clients/Personal/AgentNotes/Reference/PiDev/Architecture/06 - Extension System]] — how extensions are loaded and wired
