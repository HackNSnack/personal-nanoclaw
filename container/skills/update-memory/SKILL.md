---
name: update-memory
description: >-
  Persist a fact, preference, correction, or decision into your long-term
  memory and mirror it to Obsidian as a PR. Use when the user says
  "remember this", "update your memory", "add this to memory", "don't
  forget that", "note this for next time", or asks you to recall something
  in a future session.
metadata:
  author: mathipe
  version: '1.0.0'
---

# Update Memory

Your long-term memory is `/workspace/agent/CLAUDE.local.md`, loaded automatically every session. This skill is the sanctioned path for updating it: edit the workspace file directly, then mirror the change into Obsidian as a pull request. The mirror doc has gone stale before because a session edited memory and never opened the PR — treat the PR as part of the edit, not an optional follow-up.

## Step 1 — Identify what changed and where it belongs

| Kind of update                                          | File                               |
| ------------------------------------------------------- | ---------------------------------- |
| General preference, correction, decision, platform note | `/workspace/agent/CLAUDE.local.md` |
| Fact about a specific person (Mathias, Beate, etc.)     | `/workspace/agent/people.md`       |
| A skill was added, removed, or changed                  | `/workspace/agent/skills.md`       |

Keep the change to exactly what was asked. Don't sprawl into rewriting unrelated sections while you're in there.

## Step 2 — Edit the workspace file

Edit the file directly — no approval needed, it's your own workspace.

- Add or correct the relevant bullet/section in place; don't create a duplicate entry for a fact that already exists.
- If the fact is about delivery mechanics or tool protocol that the runtime system prompt already defines, don't write it here — link to the runtime prompt instead. Restating platform mechanics in memory is exactly how these files drift out of sync with reality.

## Step 3 — Mirror to Obsidian and open a PR

```bash
cd /workspace/agent/Obsidian-Netlight
git pull

BRANCH="memory-update-$(date +%Y%m%d)-<short-desc>"
git checkout -b "$BRANCH"
```

Copy the specific section that changed into its mirror counterpart — this is a merge, not an overwrite of the whole file:

| Workspace source  | Obsidian mirror                                                                     |
| ----------------- | ----------------------------------------------------------------------------------- |
| `CLAUDE.local.md` | `Clients/Personal/AgentNotes/Reference/NanoClaw/MEMORY.md`                          |
| `skills.md`       | `Clients/Personal/AgentNotes/Reference/NanoClaw/skills.md`                          |
| `people.md`       | The "People" section of `MEMORY.md` (no standalone mirror file exists for this one) |

```bash
git add -A
git commit -m "memory: <short description of what changed>"
GIT_SSL_NO_VERIFY=1 git push -u origin "$BRANCH"
```

Open the PR via the GitHub API — there's no `gh` CLI in the container; OneCLI injects the real token at request time:

```bash
curl -s --insecure -X POST https://api.github.com/repos/HackNSnack/Obsidian-Netlight/pulls \
  -H "Authorization: Bearer onecli-managed" \
  -H "Content-Type: application/json" \
  -H "User-Agent: Claudette/1.0" \
  -d '{
    "title": "memory: <short description>",
    "body": "<what changed and why — actual newlines, not \\n>",
    "head": "'"$BRANCH"'",
    "base": "main"
  }'
```

## Step 4 — Report back

Tell the user, in one message: what you changed, and the PR URL from the response's `html_url`. If the PR step fails (network, auth), say so explicitly — the workspace edit still stands as your live memory, but flag that the mirror is now out of sync and needs a manual retry.

## Rules

- Never skip Step 3 because the change is small — small changes are exactly what gets forgotten.
- Never overwrite `MEMORY.md` wholesale; edit only the section that changed.
- One branch, one PR per update. Don't batch unrelated memory updates into a single PR.
- If `/workspace/agent/Obsidian-Netlight` doesn't exist or `git pull` fails, say so and stop rather than silently skipping the mirror.
