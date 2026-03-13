# AgentNotes - Client Documentation

AI-assisted notes for development work, meetings, and reference knowledge.

## Structure

```
Clients/[Client]/AgentNotes/
├── Active/      # Current work
├── Archive/     # Completed work  
├── Reference/   # Evergreen patterns
└── _Index.md    # Map of Content
```

## LLM Instructions

### When to write

Write to Obsidian when user explicitly requests:
"note this", "document this", "save to obsidian", "add to notes"

### When to prompt

After these moments, ask ONCE: "Want me to note this?"

- Design/architecture decision made
- Bug root-caused and fixed  
- Meeting or discussion concluded
- Significant feature/change implemented

If user declines or ignores, move on. Do not re-ask for that topic.
Do NOT prompt for routine changes or ongoing work.

### File paths

**Active/Archive:** `Active/YYYY-MM-DD [Brief title].md`
**Reference:** `Reference/[Topic name].md` (no date)

### Frontmatter

```yaml
---
tags: [relevant, tags]
type: work | meeting | reference
status: todo | in-progress | done | blocked
---
```

### Content format

Use headers, not separate files:
- `## Problem`
- `## Investigation`
- `## Solution`
- `## Related`

Link with `[[wikilinks]]`.

### Do NOT

- Create files proactively without asking
- Ask repeatedly about the same topic
- Prompt for small/routine changes
- Create multiple files per topic
