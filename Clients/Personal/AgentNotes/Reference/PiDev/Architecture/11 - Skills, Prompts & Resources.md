# 11 — Skills, Prompts & Resources

## Summary

Pi has three resource types beyond extensions: **skills** (on-demand capability packages), **prompt templates** (reusable markdown prompts), and **themes** (UI color schemes). All are discovered by the `ResourceLoader` from standard locations (global, project, packages) and can be dynamically provided by extensions via the `resources_discover` event. Skills follow the Agent Skills standard with YAML frontmatter.

## Key Types & Interfaces

### Skills (`core/skills.ts`, ~508 LOC)

| Type | Description |
|---|---|
| `Skill` | `{name, description, content, location, filePath, modelInvocation: "auto" \| "disabled"}` |
| `SkillSource` | Where discovered: `local` / `global` / `package` / `extension` |

### Prompt Templates (`core/prompt-templates.ts`)

| Type | Description |
|---|---|
| `PromptTemplate` | `{name, description?, argumentHint?, content, filePath, source}` |

### Resource Loader (`core/resource-loader.ts`)

| Type | Description |
|---|---|
| `ResourceLoader` | Central discovery: extensions, skills, prompts, themes, context files |
| `ResourceLoaderOptions` | Paths, disable flags, system prompt overrides, extension factories |
| `ResourceExtensionPaths` | Discovered extension paths from package manifests |

## Flow

### Skill Discovery

```
Locations (checked in order, all aggregated):
1. .pi/skills/ (project)
2. .agents/skills/ (project + parent dirs)
3. ~/.pi/agent/skills/ (global)
4. ~/.agents/skills/ (global, shared standard)
5. Pi packages (npm/git installed)
6. Extension resources_discover event

Per location:
  - Each .md file: parse YAML frontmatter
  - Match: SKILL.md naming convention or frontmatter with name field
  - Dedup by name (first found wins)
```

### Skill Format

```markdown
---
name: my-skill
description: One-line description
model-invocation: auto
---
# Skill Content

Instructions for the model...
```

Frontmatter fields:
- `name` (required): lowercase, hyphens, 1-50 chars
- `description` (required): one line
- `model-invocation`: `"auto"` (default, model can invoke) or `"disabled"`

### Skill Invocation

```
1. User types: /skill-name [args]
   OR model invokes skill with auto invocation
2. Skill content is wrapped in XML: <skill name="..." location="...">content</skill>
3. Injected as user message before the agent turn
4. Model sees skill content as instructions
```

### Skills in System Prompt

When skills are available and `read` tool is active:

```
# Skills

Available skills (invoke with /skill-name or when relevant):
- skill-name: description
- another-skill: description
```

### Prompt Template Discovery

```
Locations:
1. .pi/prompts/ (project)
2. ~/.pi/agent/prompts/ (global)
3. Pi packages
4. Extension resources_discover event
```

### Prompt Template Format

```markdown
---
description: What this template does
argument-hint: <file> [options]
---
Template content with $1, $2 for positional args.
$@ for all args, $2.. for args from position 2 onward.
```

### Prompt Template Expansion

```
User types: /template-name arg1 arg2
→ expandPromptTemplate(template, "arg1 arg2"):
  - Parse arguments (respects quotes)
  - Replace $1, $2, etc.
  - Replace $@ (all args), $N.. (slice from N)
  - Return expanded text
→ Used as the user prompt
```

### Theme Discovery

```
Locations:
1. .pi/themes/ (project)
2. ~/.pi/agent/themes/ (global)
3. Pi packages
4. Extension resources_discover event

Built-in: dark, light
Hot-reload: file watcher on active theme file
```

### Resource Discovery Event

Extensions can provide additional resources:

```typescript
pi.on("resources_discover", (event, ctx) => {
  return {
    skillPaths: ["/path/to/skills/"],
    promptPaths: ["/path/to/prompts/"],
    themePaths: ["/path/to/themes/"],
  };
});
```

Fires with `reason: "startup"` or `"reload"`.

## Integration Points

| Connects to | How |
|---|---|
| **System Prompt (doc 09)** | Skills listed in system prompt; prompt templates expanded before prompting |
| **Agent Session (doc 04)** | Session parses `<skill>` blocks; expands prompt templates |
| **Extension System (doc 06)** | `resources_discover` event for dynamic resources |
| **Bootstrap (doc 01)** | ResourceLoader created during service initialization |
| **Modes (doc 10)** | Themes used by interactive mode; `/reload` refreshes all resources |

## Extension Relevance

- **Provide skills dynamically**: Use `resources_discover` to add skill directories at runtime.
- **Prompt templates as workflows**: Create templates that orchestrate complex multi-step interactions.
- **Custom themes**: Provide themes via packages or `resources_discover`.
- **Skill invocation interception**: The `input` event fires for `/skill-name` invocations — can transform or handle.
- **Pi packages**: Bundle extensions + skills + prompts + themes together. Install via `pi install npm:@scope/package` or `pi install git:github.com/user/repo`.

## Open Questions

1. **Skill content size**: No limit on skill content size. Large skills consume context window.
2. **Prompt template security**: Templates expand `$1` etc. verbatim. No sanitization.
3. **Resource reload scope**: `/reload` reloads everything. No way to reload just skills or just extensions.

## Key Files Read

| File | Lines | Purpose |
|---|---|---|
| `coding-agent/src/core/skills.ts` | 508 | Skill discovery, parsing, formatting |
| `coding-agent/src/core/prompt-templates.ts` | ~200 | Template parsing and expansion |
| `coding-agent/src/core/resource-loader.ts` | ~500 | Central resource discovery |
