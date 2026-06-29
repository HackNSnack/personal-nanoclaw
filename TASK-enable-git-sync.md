# Task: Enable git-based cross-machine sync for NanoClaw state

**For the LLM reading this on the laptop:** execute every step below in order,
then delete this file and push. This file was committed from the desktop so the
laptop can do all the real work against the live data.

---

## Background

Mathipe runs NanoClaw on two machines: this laptop and a desktop (Linux/NixOS).
The desktop was set up as a git clone of this repo. Because `data/` and `groups/`
are gitignored, the desktop started with an empty database and no agent groups —
the agent doesn't work there yet.

The fix: track the right state files in git so switching machines is just
`git push` / `git pull`. Both machines will never run simultaneously (Slack
socket mode and SQLite single-writer make that impractical anyway), so git is
sufficient. The discipline is: commit before switching.

A separate issue also hit the desktop on first boot: `better-sqlite3` was
compiled against a different Node.js version (NODE_MODULE_VERSION 137 vs 127).
That was fixed with `pnpm rebuild better-sqlite3`. A doc explaining this was
written at `docs/native-module-node-version-mismatch.md` and should be committed
here too.

---

## Steps to execute

### 1. Pull this task file (already done if you're reading this)

```bash
git pull
```

### 2. Update `.gitignore`

The current file has a blanket `data/` ignore and a `groups/*` glob that prevents
tracking. Replace both with specific exclusions so the DB and group files are
tracked while sockets, logs, and WAL files stay ignored.

Find this block in `.gitignore`:

```
# Local data & auth
store/
data/
logs/

# Groups - per-installation state, not tracked
groups/*
```

Replace it with:

```
# Local data & auth
store/
logs/

# Machine-specific runtime files — never commit
data/cli.sock
data/ncl.sock
data/circuit-breaker.json
data/upgrade-state.json
data/env/

# SQLite WAL/shared-memory files — transient, unsafe to commit mid-write.
# The main .db files ARE tracked so they can move between machines.
data/*.db-shm
data/*.db-wal
data/v2-sessions/**/*.db-shm
data/v2-sessions/**/*.db-wal

# Groups - tracked for cross-machine sync
```

### 3. Create `.gitattributes`

Create a new file `.gitattributes` at the repo root with this content:

```
# SQLite databases — mark as binary so git never attempts a text merge.
# If a conflict ever occurs (forgot to push before switching machines),
# resolve with: git checkout --ours data/v2.db  (or --theirs)
*.db binary
*.db-shm binary
*.db-wal binary
```

### 4. Stop the service cleanly

This flushes the SQLite WAL back into the main `.db` file before committing,
so the desktop receives a clean, complete database.

```bash
# macOS (launchd):
launchctl stop "$(. setup/lib/install-slug.sh && launchd_label)"
```

Wait ~5 seconds for the process to exit.

### 5. Stage everything

```bash
git add .gitignore
git add .gitattributes
git add docs/native-module-node-version-mismatch.md
git add data/v2.db
git add data/v2-sessions/   # if this directory exists
git add groups/              # agent group filesystems
```

Sanity-check what's staged — you should see the DB, sessions, groups, and the
config files. You should NOT see `data/cli.sock`, `data/ncl.sock`,
`data/circuit-breaker.json`, or any `*.db-wal` / `*.db-shm` files:

```bash
git status --short
```

### 6. Commit and push

```bash
git commit -m "Enable git-based cross-machine sync

- .gitignore: unblock data/v2.db, data/v2-sessions/, groups/;
  keep sockets, WAL files, and runtime state ignored
- .gitattributes: mark .db files as binary (no text-merge attempts)
- Commit current DB and agent groups so the desktop can pull and run
- docs/native-module-node-version-mismatch.md: document the
  better-sqlite3 NODE_MODULE_VERSION mismatch error seen on desktop"

git push
```

### 7. Restart the service

```bash
launchctl start "$(. setup/lib/install-slug.sh && launchd_label)"
```

### 8. Delete this file and push

```bash
git rm TASK-enable-git-sync.md
git commit -m "Remove completed task file"
git push
```

---

## Tell Mathipe: the ongoing switching workflow

**Before switching from laptop → desktop (or vice versa):**

```bash
# 1. Stop the service (flushes SQLite WAL)
launchctl stop <label>          # macOS
systemctl --user stop <unit>    # Linux

# 2. Commit and push state
git add data/v2.db data/v2-sessions/ groups/
git commit -m "State snapshot before switching machines"
git push
```

**On the other machine, before starting:**

```bash
git pull
launchctl start <label>         # macOS
systemctl --user start <unit>   # Linux
```

**If a conflict ever happens** (forgot to push before switching — binary conflict,
not a line-level merge conflict):

```bash
# Keep whichever side had the more recent session:
git checkout --theirs data/v2.db   # desktop's version
# or:
git checkout --ours data/v2.db     # this machine's version
git add data/v2.db
git commit -m "Resolve DB conflict, kept <machine> version"
git push
```
