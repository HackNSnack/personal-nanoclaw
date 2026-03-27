---
tags: [api, headers, security, reference]
type: reference
---

# API Request Headers

Complete reference for HTTP headers used by the Ardoq API backend (`ardoq-api`).

## Request Flow Overview

```mermaid
flowchart LR
    Client["Client / Browser"]
    Ingress["Ingress / Nginx"]
    MW["Ring Middleware"]
    Handler["Route Handler"]

    Client -->|"standard headers"| Ingress
    Ingress -->|"adds proxy headers"| MW
    MW -->|"validated req"| Handler
    Handler -->|"response"| MW
    MW -->|"adds API headers"| Client
```

**Ingress adds:** x-forwarded-host, x-ardoq-nonce, x-ardoq-geoip-*, x-real-ip, x-ardoq-trace-id

**Middleware adds to response:** X-Api-version, x-ardoq-org-label, x-ardoq-trace-id, CORS headers

## Authentication Headers

```mermaid
flowchart TD
    Auth["authorization / x-authorization"]
    Auth -->|"Token token=..."| TokenAuth
    Auth -->|"Bearer ..."| BearerAuth
    Auth -->|"Basic ..."| BasicAuth
    Auth -->|"System token=..."| SystemAuth

    subgraph TokenAuth["Token Auth"]
        T1["Format: Token token=&lt;token&gt;"]
        T2["Token: 32-char hex UUID<br/>with optional adq_ prefix"]
        T3["Spec: ::specs/token"]
    end

    subgraph BearerAuth["Bearer Auth"]
        B1["Format: Bearer &lt;token&gt;"]
        B2["Same token spec as Token auth"]
    end

    subgraph BasicAuth["Basic Auth"]
        BA1["Format: Basic &lt;base64&gt;"]
        BA2["Decoded: email:password"]
        BA3["Both email and password required"]
    end

    subgraph SystemAuth["System Token Auth"]
        S1["Format: System token=&lt;token&gt;"]
        S2["Length: greater than 7 chars"]
        S3["Charset: a-zA-Z0-9"]
        S4["Spec: ::specs/system-token"]
    end
```

### Details

| Header            | Values                                                             | Validation        | Source |
| ----------------- | ------------------------------------------------------------------ | ----------------- | ------ |
| `authorization`   | `Token token=<t>`, `Bearer <t>`, `Basic <b64>`, `System token=<t>` | See diagram above | Client |
| `x-authorization` | Same as `authorization` (fallback)                                 | Same              | Client |

**Token format**: 32-char hex string (UUID without hyphens), optionally prefixed with `adq_`.
**System token**: Alphanumeric string, >7 chars. No base64 (no padding chars).
**Basic auth**: Base64-encoded `email:password`. Both parts must be non-blank.

## Organization Resolution

```mermaid
flowchart TD
    Req["Incoming Request"]
    Req --> HostCheck{"x-forwarded-host<br/>points to custom domain?"}
    HostCheck -->|Yes| OrgFromHost["Resolve org by custom base URL"]
    HostCheck -->|No| Params{"?org= query param?"}
    Params -->|Yes| OrgFromParams["Use org label from params"]
    Params -->|No| XOrg{"x-org header?"}
    XOrg -->|Yes| OrgFromHeader["Use org label from header"]
    XOrg -->|No| Cookie{"organization cookie?"}
    Cookie -->|Yes| OrgFromCookie["Use org label from cookie"]
    Cookie -->|No| Fallback["Fallback: user favorite org<br/>or first membership"]

    OrgFromParams & OrgFromHeader & OrgFromCookie -->|"validated with<br/>org-repo/valid-db-name?"| Resolved["Resolved Organization"]
    OrgFromHost --> Resolved
    Fallback --> Resolved
```

| Header | Format | Validation | Source |
|---|---|---|---|
| `x-org` | Org label string | `org-repo/valid-db-name?` | Client |
| `x-forwarded-host` | Hostname (no port) | Matched against org custom domains | Ingress/Nginx |

## Ingress-Injected Headers

These headers are set by the ingress controller (Nginx/load balancer), not by clients.

| Header | Format | Purpose | Used In |
|---|---|---|---|
| `x-forwarded-host` | Hostname | Custom domain routing | `request_utils/host-from-req` |
| `x-real-ip` | IP address | Real client IP behind proxy | `middleware/wrap-x-real-ip` |
| `x-ardoq-nonce` | Unique string | CSP nonce for script tags | `request_utils/csp-nonce`, SAML |
| `x-ardoq-geoip-city` | City name | GeoIP city | `request_utils/geoip-city` |
| `x-ardoq-geoip-region` | Region name | GeoIP region | `request_utils/geoip-region` |
| `x-ardoq-geoip-country` | Country name | GeoIP country | `request_utils/geoip-country` |
| `x-ardoq-trace-id` | UUID | Distributed tracing | `middleware/wrap-log-context` |

**Note**: `x-ardoq-trace-id` can also be provided by clients — middleware validates it as UUID and generates one if missing or invalid.

## Standard Headers

| Header | Purpose | Used In |
|---|---|---|
| `host` | Request host (dev/ngrok only) | `request_utils/ngrok-dev-host-header` |
| `origin` | CORS origin checking | `middleware/wrap-access-control-headers` |
| `content-type` | JSON body detection | `middleware/content-type-json?` |
| `user-agent` | Client identification & tracking | `middleware/wrap-tracking-context` |
| `accept-language` | Language preference | `middleware/primary-accepted-language` |
| `sentry-trace` | Sentry distributed tracing | OpenTelemetry capture |

## Response Headers

```mermaid
flowchart LR
    subgraph Always["Always Present"]
        CT["Content-Type"]
        API["X-Api-version"]
    end

    subgraph Conditional["Conditional"]
        OL["x-ardoq-org-label<br/>when org resolved"]
        TID["x-ardoq-trace-id<br/>echo back"]
        CORS["CORS headers<br/>when origin matches<br/>and not token/basic auth"]
        LOC["Location<br/>redirects"]
        CSP["Content-Security-Policy<br/>downloads"]
    end
```

| Header | Value | Condition |
|---|---|---|
| `Content-Type` | `application/json;charset=UTF-8` or `text/plain;charset=UTF-8` | Always |
| `X-Api-version` | Version string | Always (via `wrap-api-version`) |
| `x-ardoq-org-label` | Org label | When org is resolved |
| `x-ardoq-trace-id` | UUID | Always (generated or echoed) |
| `access-control-allow-origin` | Origin URL | When CORS origin is whitelisted and not token/basic auth |
| `access-control-allow-credentials` | `"true"` | With CORS |
| `access-control-allow-headers` | `"content-type"` | With CORS |
| `vary` | `"Origin"` | With CORS |
| `Content-Security-Policy` | Restrictive CSP | Downloads only |
| `Content-Disposition` | `attachment; filename="..."` | Downloads only |
| `Location` | URL | Redirects (custom domain, missing org, choose org) |
| `WWW-Authenticate` | `Token realm="Ardoq"` | 401 responses |
| `connection` | `"close"` | Failed WebSocket upgrades |

## Middleware Pipeline (Header-Relevant)

```mermaid
flowchart TD
    A["wrap-sanitize-CRLF<br/>Escape CRLF in params and response headers"] --> B
    B["wrap-x-real-ip<br/>Read x-real-ip into remote-addr"] --> C
    C["wrap-log-context<br/>Read/generate x-ardoq-trace-id"] --> D
    D["wrap-organization<br/>Resolve org, set x-ardoq-org-label"] --> E
    E["wrap-access-control-headers<br/>Set CORS headers from origin"] --> F
    F["wrap-api-version<br/>Set X-Api-version"] --> G
    G["wrap-ws-resp-connection-header<br/>Set connection close on failed WS"]
```

## Key Source Files

- `src/ardoq/utils/request_utils.clj` — Header reading, auth parsing, CORS
- `src/ardoq/middleware.clj` — Middleware that reads/writes headers
- `src/ardoq/utils/org_resolver.clj` — Org resolution from headers/cookies/params
- `src/ardoq/specs.clj` — Token and system-token specs
- `src/ardoq/auth/api.clj` — Auth handlers using parsed tokens
