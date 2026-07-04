---
name: add-container-skill
description: "Create or update a SKILL.md that the nanoclaw *agent* (running inside the container) can use — as opposed to a .claude/skills entry for the fork maintainer. Use when the user says 'add a container skill', 'give the agent a new skill', 'teach the agent how to X', 'add a skill under container/skills', or wants to extend what the in-container agent knows how to do (formatting rules, a CLI it should use, a workflow like the wiki pattern)."
---

# Add a Container Skill

Creates a new `container/skills/<name>/SKILL.md` — a skill the **nanoclaw agent itself** loads at runtime, distinct from `.claude/skills/`, which is for the person/agent working on this repo (see `/learn` for that side). This skill is instruction-only: no code, no reach-ins into core.

## When to use

- "Teach the agent to format messages for X"
- "Add a skill so the agent knows how to use `<cli tool>`"
- "Give the agent a maintained wiki / reference doc it should follow"
- Any capability that should live in the agent's own skill set, mounted read-only into every container

If the ask is instead about changing _your own_ (maintainer-side) workflow, use `/learn` — it targets `.claude/skills/`, not `container/skills/`.

## Background — read before authoring

This is the authoritative source for how skills work in this repo; don't improvise past it:

- `docs/customizing.md` — the one-paragraph idea: every change is an additive skill.
- `docs/skill-guidelines.md` — the checklist: minimal integration surface, additive change shapes, when a `REMOVE.md` is required, anti-patterns (no `VERIFY.md`, no soft-disabled removal, no branch merges).
- `docs/skills-model.md` — why the model exists and how it survives upstream upgrades.

The short version that applies to _most_ container skills: a container skill is prose an agent reads. It adds a file, nothing else. Per `skill-guidelines.md`'s "Content / instruction-only" archetype, that makes it a **pure-add skill: no functional reach-in, no required test, no `REMOVE.md`** (deleting the folder is the whole removal).

That changes if the skill also touches things _outside_ `container/skills/<name>/` — e.g. it edits a group's `CLAUDE.md` or seeds files elsewhere in the group folder (see `.claude/skills/add-karpathy-llm-wiki/SKILL.md` for the worked example: it creates a container skill _and_ wraps a `CLAUDE.md` section in `<!-- BEGIN ... -->`/`<!-- END ... -->` markers so it's idempotent and locatable). If your skill does that, follow the same marker-comment pattern and ship a `REMOVE.md` that reverses every part of it (skill-guidelines.md anti-pattern #2 and #3: no soft-disable, no incomplete cleanup).

## How container skills get loaded (mechanics)

- `container/skills/<name>/` is mounted read-only into every container at `/app/skills` (`src/container-runner.ts`).
- Per agent group, `container.json`'s `skills` field controls which are active: `"all"` (default — auto-picks up every folder under `container/skills/`, no config change needed) or an explicit array of names.
- The runner materializes symlinks in `.claude-shared/skills/` per group to match that selection.
- No rebuild required — it's a markdown mount. A container restart (or next spawn) is enough to pick up a new or edited skill.

## Workflow

### 1. Clarify scope

Ask (or infer from context) what the agent should learn to do, and whether it's a pure prose skill or needs example commands/reference tables. Check for an existing skill that already covers it:

```bash
ls container/skills/
grep -ril "<topic>" container/skills/
```

If one exists and this is a refinement, edit it in place rather than duplicating (mirror `/learn`'s refine behavior: preserve structure, dedupe, correct stale parts).

### 2. Author the SKILL.md

Write `container/skills/<kebab-name>/SKILL.md`. Frontmatter conventions observed across existing skills (`welcome`, `slack-formatting`, `agent-browser`, `onecli-gateway`):

```yaml
---
name: <kebab-case, matches the folder>
description: <what it does + concrete trigger phrases/conditions — this is what the agent matches on>
# optional:
allowed-tools: Bash(some-cli:*) # scope the skill to specific tools, if relevant
compatibility: <runtime requirement, e.g. "Requires HTTPS_PROXY set">
metadata:
  author: <name>
  version: '<semver>'
---
```

Body: a `# Title`, then whatever structure fits — quick-start commands, a reference table, a "what NOT to do" section, examples. Look at `container/skills/slack-formatting/SKILL.md` (compact reference) and `container/skills/self-customize/SKILL.md` (decision-tree workflow) as shape templates depending on whether this is a _reference_ skill or a _procedure_ skill.

Keep it additive and self-contained per `skill-guidelines.md`:

- Everything the skill needs lives in its own folder (`container/skills/<name>/`). A large reference doc can live alongside as e.g. `reference.md` and be pointed to from `SKILL.md`, but prefer inlining unless it's genuinely long.
- Don't reach into other files unless the capability requires it (see the `CLAUDE.md`-editing exception above).
- Write present-tense instructions only — no "this replaces the old X" framing (anti-pattern #7 in `skill-guidelines.md`); a skill should read as a standalone artifact.

### 3. Check the target group's skill selection

```bash
cat groups/<folder>/container.json | grep -A3 '"skills"'
```

- If `"skills": "all"` — nothing else to do, the new skill is picked up automatically.
- If it's an explicit array, the new skill name needs adding to it. There's no dedicated `ncl` verb for this yet; update the `container_configs.skills` JSON column directly and restart:

  ```bash
  pnpm exec tsx scripts/q.ts data/v2.db "UPDATE container_configs SET skills = json_insert(skills, '$[#]', '<name>') WHERE agent_group_id = '<group-id>'"
  ```

  Then `ncl groups restart --id <group-id>` (or ask the user to) so the symlink sync picks it up.

### 4. Verify

- Folder name matches the frontmatter `name`.
- YAML frontmatter parses (no tabs, quote any value containing `:`).
- If the skill is a procedure (not pure reference), sanity-check the steps make sense standalone — no assumed context from this conversation.

### 5. Ship it

This is a plain file addition — commit directly:

```bash
git add container/skills/<name>/
git commit -m "container/skills: add <name>"
```

No build step, no image rebuild. Tell the user the skill is live on next container start/restart, and — per the docs above — that per `skill-guidelines.md` this is a conformant pure-add skill: no test or `REMOVE.md` required unless it also touched a group's `CLAUDE.md` or other files, in which case confirm a `REMOVE.md` was written to reverse that part.

## Reference: existing container skills

| Skill                                      | Shape                                                      |
| ------------------------------------------ | ---------------------------------------------------------- |
| `welcome`                                  | Procedure — onboarding script                              |
| `self-customize`                           | Procedure — decision tree + delegation workflow            |
| `slack-formatting` / `whatsapp-formatting` | Reference — formatting rules table                         |
| `agent-browser`                            | Reference — CLI command reference, uses `allowed-tools`    |
| `onecli-gateway`                           | Reference — proxy usage, uses `compatibility` + `metadata` |
| `frontend-engineer`, `vercel-cli`          | Reference — tool-specific usage                            |

`.claude/skills/add-karpathy-llm-wiki/SKILL.md` is the one example of a skill that _generates_ a container skill as part of a larger workflow — read it if the request is more involved than a single self-contained skill (e.g. it also needs group-folder scaffolding or a `CLAUDE.md` section).
