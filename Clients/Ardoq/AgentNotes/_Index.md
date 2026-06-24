# Ardoq - Index

Map of Content for Ardoq development notes.

## Active Work

- [[Clients/Ardoq/AgentNotes/Active/2026-06-22 AI-962 MCP + Agent Tool Consolidation - Architecture Analysis|AI-962 MCP + Agent Tool Consolidation — Architecture Analysis]] — Why full tool consolidation is impossible; the 6-location scaffolding redundancy map + A→E sequence; ties into AI-1286 (Approach 1)

## Recently Archived

- [[Clients/Ardoq/AgentNotes/Archive/2026-06-10 AI-1286 Approach 1 - Domain Errors|AI-1286 Approach 1 — Domain Errors + Handler Classification]]
- [[Clients/Ardoq/AgentNotes/Archive/2026-06-10 AI-1286 Approach 2 - Raise at Source|AI-1286 Approach 2 — Raise at Source]]
- [[Clients/Ardoq/AgentNotes/Archive/Starlette BadHost Upgrade/_Index|Starlette BadHost (CVE-2026-48710) — Monorepo Upgrade Map]] — Dependency graph + per-project starlette audit across the monorepo
- [[Clients/Ardoq/AgentNotes/Archive/2026-04-27 Sub-agent visibility - non-technical overview]] - Non-technical explainer: what is visible in real time today, the silent window, and effort levels to improve it
- [[Clients/Ardoq/AgentNotes/Archive/2026-04-21 Pi.dev Claude Code API Key 429 Error Investigation]] - Root cause analysis and extension workaround for pi.dev Sonnet/Opus 429 errors
- [[Clients/Ardoq/AgentNotes/Archive/2026-03-25 ai_observability refactor to functional architecture]]
- [[Clients/Ardoq/AgentNotes/Archive/2026-03-24 Refactor ai_observability to functional patterns]]
- [[Clients/Ardoq/AgentNotes/Archive/2026-03-23 SubAgentResult and completion schema complexity analysis]]
- [[Clients/Ardoq/AgentNotes/Archive/2026-03-23 Simplify dynamic agent return]]
- [[Clients/Ardoq/AgentNotes/Archive/2026-03-23 Replace collector callback with dict accumulator]]
- [[Clients/Ardoq/AgentNotes/Archive/2026-03-19 LLM variance testing script]]

- [[2026-04-13 LLM Evaluation Pipeline - Architecture]] - System design for LLM-as-judge on customer sessions

- [[2026-04-13 LLM Evaluation Pipeline - Visual]] - Mermaid diagrams of eval pipeline data flow

- [[2026-03-24 Nested sub-agent result propagation design]]

## Key Decisions

- [[Clients/Ardoq/AgentNotes/Archive/2026-03-13 Obsidian structure redesign]] - Adopted simplified note structure

## Reference

### Infrastructure
- [[Clients/Ardoq/AgentNotes/Reference/Infrastructure/Architecture - Visual]] - Mermaid diagrams of multi-region infrastructure, tenant isolation, K8s architecture
- [[Clients/Ardoq/AgentNotes/Reference/Infrastructure/Architecture - Explained]] - Textual deep-dive on regions, isolation model, backup/DR, traffic flow

### Development
- [[Clients/Ardoq/AgentNotes/Reference/Development/Model Context Protocol (MCP)]] - Protocol overview, pros/cons, adoption
- [[Clients/Ardoq/AgentNotes/Reference/Development/Dynamic Agent Context Flow]] - Mermaid diagrams of agent context variable flow
- [[Clients/Ardoq/AgentNotes/Reference/Development/My Code Review Standards]] - Personal review standards extracted from PR history
- [[Clients/Ardoq/AgentNotes/Reference/Development/API Request Headers]] - Complete HTTP header reference for ardoq-api

- [[Clients/Ardoq/AgentNotes/Reference/Development/2026-06-22 AI-1026 Pydantic Model Sync CI Approaches]] - Dependency chain problem, committed-artifact vs generate-in-CI approaches with full Mermaid diagrams
- [[Clients/Ardoq/AgentNotes/Reference/Development/2026-06-22 AI-1026 Implementation Plan]] - Concrete implementation plan: lein alias, committed JSON artifact, unified sync_models.sh (--check), moon tasks, both CI checks

#### Sub-Agent Streaming
- [[Clients/Ardoq/AgentNotes/Reference/Development/Sub-Agent Streaming - Demo Agent]] — `nested_demo_agent` + `word_count_agent` reference implementation
- [[Clients/Ardoq/AgentNotes/Reference/Development/Sub-Agent Streaming - Test Suite]] — Unit test harness: `conftest.py`, `test_sub_agent.py`, `test_sub_agent_nesting.py`, `test_streaming_sub_agent.py`
- [[Clients/Ardoq/AgentNotes/Reference/Development/Sub-Agent Streaming - Stream Visualizer]] — NDJSON CLI visualizer + FastAPI smoke tests
