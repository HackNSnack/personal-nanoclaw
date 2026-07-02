---
created: 2026-06-29
status: planned
tags: [nanoclaw, nixos, git, sync]
---

# NanoClaw Cross-Machine Sync Plan

Sync NanoClaw state (DB, agent memory, session history) between laptop and desktop via a **private git repo + symlinks**, keeping the public nanoclaw fork clean.

> [!info] Constraint
> Both machines are NixOS. The nanoclaw fork (`HackNSnack/personal-nanoclaw`) is public — no private data can land there.

---

## What needs syncing

| File/Dir                                      | Why                                      | Size                  |
| --------------------------------------------- | ---------------------------------------- | --------------------- |
| `data/v2.db`                                  | All routing, agent groups, session index | ~5 MB after WAL flush |
| `data/v2-sessions/<id>/.claude-shared/`       | Claude settings, skill symlinks          | ~170 KB               |
| `data/v2-sessions/<id>/sess-*/inbound.db`     | Per-session message history              | ~65 KB each           |
| `data/v2-sessions/<id>/sess-*/outbound.db`    | Per-session response history             | ~37 KB each           |
| `groups/cli-with-mathipe/CLAUDE.local.md`     | **Agent memory** — most critical         | ~12 KB                |
| `groups/cli-with-mathipe/container.json`      | Skills, provider, assistant name         | tiny                  |
| `groups/cli-with-mathipe/*.md`, scripts, etc. | Research notes, small files              | ~700 KB               |

**Not synced (by design):**

- `nanoclaw-fork/`, `Obsidian-Netlight/`, `.pi-config/`, `Hyprland-Dots/` — nested git repos, re-clone from remotes on first use per machine. Agent knows the URLs via `CLAUDE.local.md`.
- `data/v2-sessions/**/agent/`, `**/group/` — root-owned container artifacts, recreated on next spawn.
- All WAL/SHM files, sockets, runtime state.

---

## Step 1 — Code fix in nanoclaw fork

**File:** `src/session-manager.ts`  
**Function:** `writeSessionMessage`

Add a session-directory recovery guard before the DB is opened. Without this, the bot crashes on the first message for any pre-existing session whose directory doesn't exist on the new machine.

```ts
export function writeSessionMessage(
  agentGroupId: string,
  sessionId: string,
  message: { ... },
): void {
  // Recreate session folder if missing (e.g. after machine switch / accidental deletion)
  const dir = sessionDir(agentGroupId, sessionId);
  if (!fs.existsSync(dir)) {
    initSessionFolder(agentGroupId, sessionId);
  }

  // existing code unchanged below...
}
```

`initSessionFolder` already uses `{ recursive: true }` mkdir and idempotent `ensureSchema` — safe to call defensively. Commit this to the public fork.

---

## Step 2 — Create the private state repo

Create a **private** GitHub repo: `HackNSnack/nanoclaw-private-state`

### `.gitignore` for the state repo

```gitignore
# SQLite WAL / SHM — never commit mid-write
*.db-shm
*.db-wal

# Runtime files — machine-local
data/cli.sock
data/ncl.sock
data/circuit-breaker.json
data/upgrade-state.json
data/env/
data/Dockerfile.*

# Container-created dirs inside session sandboxes (root-owned)
data/v2-sessions/**/agent/
data/v2-sessions/**/group/
data/v2-sessions/**/.heartbeat
data/v2-sessions/**/opencode-xdg/

# Large repos the agent clones into its workspace
groups/*/Obsidian-Netlight/
groups/*/nanoclaw-fork/
groups/*/Hyprland-Dots/
groups/*/.pi-config/
groups/*/.pnpm-store/

# Generated per-spawn
groups/**/.claude-fragments/
groups/**/.claude-shared.md

# CLAUDE.md is regenerated from DB on every spawn — don't sync
groups/**/CLAUDE.md
```

### `.gitattributes` for the state repo

```gitattributes
*.db     binary
*.db-shm binary
*.db-wal binary
```

---

## Step 3 — One-time setup (primary machine first)

```bash
# Stop the service (flushes SQLite WAL → main .db)
systemctl --user stop "$(. setup/lib/install-slug.sh && systemd_unit)"

# Move live dirs into the state repo location
mkdir -p ~/nanoclaw-state
mv ~/Prosjekter/Personal/Slackbot/nanoclaw_bot/nanoclaw/data   ~/nanoclaw-state/data
mv ~/Prosjekter/Personal/Slackbot/nanoclaw_bot/nanoclaw/groups ~/nanoclaw-state/groups

# Init the private repo
cd ~/nanoclaw-state
git init
git remote add origin git@github.com:HackNSnack/nanoclaw-private-state.git

# Add .gitignore + .gitattributes, then initial commit
git add .gitignore .gitattributes data/v2.db data/v2-sessions/ groups/
git commit -m "Initial state snapshot"
git push -u origin main

# Symlink back into the nanoclaw project
NANOCLAW=~/Prosjekter/Personal/Slackbot/nanoclaw_bot/nanoclaw
ln -s ~/nanoclaw-state/data   $NANOCLAW/data
ln -s ~/nanoclaw-state/groups $NANOCLAW/groups

# Restart
systemctl --user start "$(. setup/lib/install-slug.sh && systemd_unit)"
```

> [!note] Why symlinks work
> `src/config.ts` resolves paths as `path.resolve(process.cwd(), 'data')` — purely textual. The OS follows the symlink transparently when files are actually opened. No code changes needed.

### Update public fork `.gitignore`

`data/` (trailing slash) only matches directories. A symlink named `data` is tracked as a file and would be committed. Add bare forms:

```gitignore
# Replace the existing data/groups lines with:
data
data/
groups
groups/*
```

---

## Step 4 — Setup on the other machine

```bash
# Clone the state repo
git clone git@github.com:HackNSnack/nanoclaw-private-state.git ~/nanoclaw-state

# Symlink into nanoclaw (assumes nanoclaw repo is already cloned + set up)
NANOCLAW=~/Prosjekter/Personal/Slackbot/nanoclaw_bot/nanoclaw
ln -s ~/nanoclaw-state/data   $NANOCLAW/data
ln -s ~/nanoclaw-state/groups $NANOCLAW/groups

# Start the service
systemctl --user start "$(. setup/lib/install-slug.sh && systemd_unit)"
```

On first use, the agent will find that `Obsidian-Netlight`, `nanoclaw-fork`, and `.pi-config` are missing from its workspace. It knows the URLs from `CLAUDE.local.md` and will re-clone on demand. One-time cost per machine.

---

## Switching workflow (ongoing)

### Before switching machines

```bash
# 1. Stop the service (flush WAL)
systemctl --user stop "$(. setup/lib/install-slug.sh && systemd_unit)"

# 2. Commit and push state
cd ~/nanoclaw-state
git add -A
git commit -m "State snapshot $(date '+%Y-%m-%d %H:%M')"
git push
```

### On the receiving machine

```bash
cd ~/nanoclaw-state
git pull

systemctl --user start "$(. setup/lib/install-slug.sh && systemd_unit)"
```

### If there's a binary conflict (forgot to push before switching)

```bash
# Keep whichever machine had the more recent session
git checkout --theirs data/v2.db   # desktop's version
# or
git checkout --ours data/v2.db     # this machine's version

git add data/v2.db
git commit -m "Resolve DB conflict, kept <machine> version"
git push
```

---

## Checklist

- [ ] Code fix in `src/session-manager.ts` (`writeSessionMessage` guard) committed to public fork
- [ ] Private repo `HackNSnack/nanoclaw-private-state` created
- [ ] `.gitignore` + `.gitattributes` added to state repo
- [ ] `.gitignore` in public fork updated (`data` / `groups` bare forms)
- [ ] Primary machine: dirs moved, symlinks created, initial push done
- [ ] Other machine: state repo cloned, symlinks created
- [ ] Test: send a message, switch, send another — confirm no crash, memory preserved
