---
tags: [mcp, ai-protocols, integration, research]
type: reference
---

# Model Context Protocol (MCP)

Open standard by Anthropic (Nov 2024) for connecting AI applications to external data sources/tools via JSON-RPC 2.0. Now governed by **Agentic AI Foundation (AAIF)** under Linux Foundation.

## Architecture

| Component | Role |
|-----------|------|
| **MCP Host** | AI application (Claude Desktop, VS Code) |
| **MCP Client** | Component maintaining server connections |
| **MCP Server** | Program providing tools/resources |

**Core Primitives:**
- **Tools**: Executable functions (DB queries, API calls)
- **Resources**: Data sources (files, records)
- **Prompts**: Reusable LLM templates

## Current State (March 2026)

- **Spec version**: 2025-11-25
- **Governance**: Linux Foundation AAIF (Dec 2025)
- **Backers**: Anthropic, OpenAI, Google, Microsoft, AWS, Bloomberg, Cloudflare
- **Ecosystem**: 40+ curated registry servers, 1,000+ community servers

## Why MCP Exists

Solves M×N integration problem—each AI app × each data source = custom integration.

**Solution**: Build once, connect to many. Like USB for AI tool connections.

## MCP vs Alternatives

| Aspect | Function Calling | MCP |
|--------|------------------|-----|
| Scope | JSON output describing call | Full discovery/invocation protocol |
| Portability | Vendor-specific | Universal standard |
| Discovery | Static definitions | Dynamic via `tools/list` |

| Aspect | LangChain Tools | MCP Tools |
|--------|-----------------|-----------|
| Architecture | Python callables | Independent servers via JSON-RPC |
| Portability | LangChain only | Any MCP host |

## Pros

- Standardization replaces fragmented integrations
- 1,000+ servers, major vendor backing
- Write once, use anywhere
- Vendor-neutral (Linux Foundation)
- Remote deployment via Streamable HTTP

## Cons

- Security risks: prompt injection, tool poisoning, confused deputy
- Ecosystem immaturity: incomplete tool descriptions
- No error-handling standard
- Context window pressure with many tools
- Overkill for simple 2-3 tool cases

**Simon Willison warning**: Treat security "SHOULD"s as "MUST"s.

## Adoption

Anthropic, OpenAI, Microsoft (GitHub Registry, VS Code), Google, Block, Cloudflare, Figma, Postman, HashiCorp, Sentry

## Sources

- [MCP Specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [Anthropic Announcement](https://www.anthropic.com/news/model-context-protocol)
- [Linux Foundation AAIF](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)
- [Simon Willison Security Analysis](https://simonwillison.net/2025/Apr/9/mcp-prompt-injection/)
