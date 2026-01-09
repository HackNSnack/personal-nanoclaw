# AgentNotes - Personal Development Documentation

Dynamically generated notes from agent conversations organized by work type and feature/component.

## LLM Instructions

### 1. Classify Work Type
Determine which category applies:
- **Features/** - New features or enhancements
- **Bug Fixes/** - Bug fixes and issue resolutions
- **Architecture/** - System design and architectural decisions
- **Reference/** - General patterns and lessons

### 2. Create Subdirectory
For Features/Bug Fixes/Architecture: Create a descriptive subdirectory (e.g., `Features/User-Auth`, `Bug Fixes/Performance-Issue-123`)
For Reference: Update existing documents directly

### 3. Documentation Standards

#### Features/[Name]
- **Overview.md** - Requirements, scope, acceptance criteria
- **Architecture.md** - Design decisions, patterns, approach
- **Implementation.md** - Code snippets, modified files, edge cases
- **Testing.md** - Test scenarios, edge cases
- **Snippets/** - Incremental learnings as conversation progresses (snippet_001.md, snippet_002.md, ...)

#### Bug Fixes/[Name]
- **Problem.md** - Issue description, symptoms, root cause
- **Solution.md** - Fix applied, code changes, why chosen
- **Lessons.md** - Patterns to watch, prevention, testing gaps
- **Snippets/** - Investigation steps, findings, logs

#### Architecture/[Name]
- **Decision.md** - What was decided, problem solved, applicability
- **Rationale.md** - Why chosen, alternatives considered, trade-offs
- **Implementation.md** - How realized, components, patterns
- **Related Issues.md** - Related features, bugs, architecture links
- **Snippets/** - Discussion points, explorations, diagrams

#### Reference/
- **Common Patterns.md** - Recurring solutions, code patterns, best practices
- **Integration Points.md** - Third-party integrations, APIs, data flows
- **Gotchas & Lessons.md** - Mistakes to avoid, quirks, security/performance notes

### 4. Snippet vs Structured Files
- **Snippets/** - Create continuously during conversations (snippet_001.md, snippet_002.md, ...)
- **Structured files** (Overview, Architecture, etc.) - Create only when user explicitly requests them, distilling content from existing snippets

### 5. Workflow
- **Proactively create snippets** as user describes work
- **Create structured files** upon user request, synthesizing snippet content
- **Cross-reference** related work
- **Update Reference/** when discovering broadly applicable lessons

### 6. Conventions
- Directory names: Descriptive with hyphens (e.g., `User-Authentication`)
- Snippet files: Sequential numbering (snippet_001.md, snippet_002.md, ...)
- Main documents: Capitalized (Overview.md, Architecture.md, ...)

## Directory Structure

```
Clients/Myself/AgentNotes/
├── README.md
├── Features/[Name]/
│   ├── Overview.md
│   ├── Architecture.md
│   ├── Implementation.md
│   ├── Testing.md
│   └── Snippets/
├── Bug Fixes/[Name]/
│   ├── Problem.md
│   ├── Solution.md
│   ├── Lessons.md
│   └── Snippets/
├── Architecture/[Name]/
│   ├── Decision.md
│   ├── Rationale.md
│   ├── Implementation.md
│   ├── Related Issues.md
│   └── Snippets/
└── Reference/
    ├── Common Patterns.md
    ├── Integration Points.md
    └── Gotchas & Lessons.md
```
