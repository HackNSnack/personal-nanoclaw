# Task: Enable git-based cross-machine sync for NanoClaw state

**For the LLM reading this:** This is an action file left by a pi session on the
desktop machine. Execute the steps below in order, then delete this file and commit.

---

## Background

Mathipe runs NanoClaw on two machines: a laptop (you, now) and a desktop (Linux).
The desktop was set up as a clone of this repo. Because `data/` and `groups/` are
gitignored, the desktop started with an empty database and no agent groups — the
agent doesn't work there yet.

The fix: track the state files in git so switching machines is just `git push` /
`git pull`. Both machines will never run simultaneously (Slack socket mode +
SQLite single-writer make that impractical), so git is sufficient — just
commit before switching.

A pi session on the desktop already made these changes (not yet on this machine):

- **`.gitignore`** — `data/` unblocked; only machine-specific runtime files
  (sockets, circuit-breaker, WAL files) remain ignored.
- **`.gitattributes`** — `.db` files marked as `binary` so git never attempts
  a text merge. Conflicts (if they ever occur from forgetting to push) are
  resolved with `git checkout --ours` or `--theirs`, not a line merge.
- **`.stignore`** — ignore rules for Syncthing (optional; harmless if unused).
- **`docs/native-module-node-version-mismatch.md`** — documents the
  `better-sqlite3` NODE_MODULE_VERSION mismatch error that hit the desktop on
  first boot (Node version changed; fixed with `pnpm rebuild better-sqlite3`).

---

## Steps to execute

### 1. Pull the desktop's changes

```bash
git pull
```

Verify the updated `.gitignore` is in place — `data/v2.db` should now be
untracked-but-visible (`git status` should show it under untracked or modified,
not silently ignored).

### 2. Stop the service cleanly

This checkpoints the SQLite WAL back into the main `.db` file before committing.

```bash
systemctl --user stop "$(. setup/lib/install-slug.sh && systemd_unit)" 2>/dev/null \
  || launchctl stop "$(. setup/lib/install-slug.sh && launchd_label)" 2>/dev/null
```

Wait ~5 seconds for the process to exit and SQLite to flush.

### 3. Stage the state files

```bash
git add data/v2.db
git add data/v2-sessions/   # if this directory exists
git add groups/              # agent group filesystems
```

Check what's staged:

```bash
git status --short
```

You should see `data/v2.db`, any session DBs under `data/v2-sessions/`, and
the contents of `groups/` staged. You should NOT see `data/cli.sock`,
`data/ncl.sock`, `data/circuit-breaker.json`, or any `*.db-wal` / `*.db-shm`
files — those remain ignored.

### 4. Commit and push

```bash
git commit -m "Add state files for cross-machine sync

Tracks data/v2.db, data/v2-sessions/, and groups/ so the desktop
can pull and run with the same agent state. See TASK-enable-git-sync.md
for full context (that file is now deleted)."

git push
```

### 5. Restart the service on this machine

```bash
systemctl --user start "$(. setup/lib/install-slug.sh && systemd_unit)" 2>/dev/null \
  || launchctl start "$(. setup/lib/install-slug.sh && launchd_label)" 2>/dev/null
```

### 6. Delete this file and commit that too

```bash
git rm TASK-enable-git-sync.md
git commit -m "Remove completed task file"
git push
```

---

## The ongoing workflow (tell Mathipe)

**Before switching from laptop → desktop (or vice versa):**

```bash
# Stop the service
systemctl --user stop <unit>      # Linux
# or: launchctl stop <label>      # macOS

# Commit and push state
git add data/v2.db data/v2-sessions/ groups/
git commit -m "State snapshot before switching to <other machine>"
git push
```

**On the other machine, before starting:**

```bash
git pull
systemctl --user start <unit>    # Linux
# or: launchctl start <label>    # macOS
```

**If a conflict ever happens** (forgot to push before switching):

```bash
# Keep whichever machine had the more recent session:
git checkout --theirs data/v2.db   # or --ours
git add data/v2.db
git commit -m "Resolve DB conflict, kept <machine> version"
```

---

## Done

Once steps 1–6 are complete, the desktop can `git pull` and have a fully working
NanoClaw instance with all existing agents, sessions, and history intact.
