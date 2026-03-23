---
tags: [obsidian, documentation, ai-integration]
type: work
status: done
---
# Obsidian structure redesign

## Problem
Previous AgentNotes structure was too verbose—4 categories, 5+ files per topic, proactive snippet creation. LLM spent too much time generating markdown.

## Solution
Adopted hybrid approach (PARA-lite + Zettelkasten):
- 3 lifecycle folders: Active, Archive, Reference
- One atomic note per topic
- Sections via headers, not separate files
- Links via `[[wikilinks]]` for graph connectivity

## Decision
LLM writes only on explicit request OR asks once after significant moments (decisions, bug fixes, meetings). No proactive creation.

## Related
- [[Clients/Ardoq/AgentNotes/_Index]]
