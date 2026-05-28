# Pi Clean Reinstall Guide

A step-by-step plan for completely removing all pi-related files and doing a fresh reinstall, leaving no dangling artefacts from prior setups.

> **Context:** Written after a pnpm v10 → v11 store migration broke `pi update`. Also covers the NixOS-specific quirks (`pnpm setup` read-only filesystem error, global bin directory path change).

---

## What's on disk (full map)

| Location | What it is |
|---|---|
| `~/.pi/` | Main pi config/data directory |
| `~/.pi/agent/agents/` | Your custom agents |
| `~/.pi/agent/skills/` | Your custom skills |
| `~/.pi/agent/extensions/` | Your custom extensions |
| `~/.pi/agent/npm/` | Pi-managed npm extension install dir (created automatically, replaces old global install approach) |
| `~/.pi/agent/git/` | Pi-managed git extension installs |
| `~/.pi/agent/sessions/` | Session history |
| `~/.pi/agent/settings.json` | Pi configuration |
| `~/.pi/agent/auth.json` | API keys / auth tokens |
| `~/.pi/agent/permissions.json` | Tool permissions |
| `~/.pi/agent/mcp-oauth/` | MCP OAuth tokens (e.g. Atlassian) — needs re-auth after reinstall |
| `~/.pi/bin/pnpm-npm-wrapper.sh` | Pi's internal pnpm wrapper script |
| `~/.pi/pi-mono/` | Pi source repo clone (if present) |
| `~/.local/share/pnpm/global/5/.pnpm/@earendil-works+pi-*` | Current pi global packages |
| `~/.local/share/pnpm/global/5/.pnpm/@mariozechner+pi-*` | Old pi global packages (legacy namespace) |
| `~/.local/share/pnpm/global/5/.pnpm/@diegopetrucci+pi-*` | Old pi-extensions global packages |
| `~/.local/share/pnpm/pi` and `pi-ai` | Pi binaries at old pnpm bin location (pre-pnpm 11) |
| `~/.local/share/pnpm/bin/pi` and `pi-ai` | Pi binaries at new pnpm bin location (pnpm 11+) |
| `~/.local/share/pnpm/store/v11/` | Shared pnpm content store (don't delete, just prune) |
| `~/.zshrc` pnpm block | Shell PATH config written by `pnpm setup` |

---

## Step 1 — Back up personal files

These are files pi **does not recreate** on reinstall:

```bash
mkdir -p ~/pi-backup
cp -r ~/.pi/agent/agents     ~/pi-backup/agents
cp -r ~/.pi/agent/skills     ~/pi-backup/skills
cp -r ~/.pi/agent/extensions ~/pi-backup/extensions
cp ~/.pi/agent/settings.json ~/pi-backup/settings.json
cp ~/.pi/agent/auth.json     ~/pi-backup/auth.json
cp ~/.pi/agent/permissions.json ~/pi-backup/permissions.json
```

Optionally also save session history:

```bash
cp ~/.pi/agent/run-history.jsonl ~/pi-backup/run-history.jsonl
cp -r ~/.pi/agent/sessions ~/pi-backup/sessions
```

---

## Step 2 — Remove the pi binaries and global packages

Multiple stale versions accumulate across old package namespaces. Remove them all:

```bash
# Uninstall via pnpm (best-effort, may not catch everything)
pnpm remove -g @earendil-works/pi-coding-agent 2>/dev/null
pnpm remove -g @mariozechner/pi-coding-agent 2>/dev/null

# Remove old-location binaries (pre-pnpm 11 path)
rm -f ~/.local/share/pnpm/pi
rm -f ~/.local/share/pnpm/pi-ai

# Nuke leftover dangling global package trees directly
rm -rf ~/.local/share/pnpm/global/5/.pnpm/@earendil-works+pi-*
rm -rf ~/.local/share/pnpm/global/5/.pnpm/@mariozechner+pi-*
rm -rf ~/.local/share/pnpm/global/5/.pnpm/@diegopetrucci+pi-*
rm -rf ~/.local/share/pnpm/global/5/.pnpm/@ollama+pi-*
```

---

## Step 3 — Remove `~/.pi` entirely

```bash
rm -rf ~/.pi
```

This removes everything: npm/git extension dirs, session history, the wrapper script, the `pi-mono` source clone, debug logs, folder history, and all caches.

---

## Step 4 — Prune the pnpm store

Do **not** delete the store outright — it is shared across all your pnpm projects. Just prune orphaned entries:

```bash
pnpm store prune
```

---

## Step 5 — Check `.zshrc`

The pnpm PATH block was written by `pnpm setup` and should be left in place. On NixOS, **never re-run `pnpm setup`** — it tries to write into the read-only Nix store.

The block should look like this (both `$PNPM_HOME` and `$PNPM_HOME/bin` in PATH — the `/bin` suffix is new in pnpm 11):

```zsh
# pnpm
export PNPM_HOME="/home/mathipe/.local/share/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac
case ":$PATH:" in
  *":$PNPM_HOME/bin:"*) ;;
  *) export PATH="$PNPM_HOME/bin:$PATH" ;;
esac
# pnpm end
```

---

## Step 6 — Reinstall pi

```bash
source ~/.zshrc   # ensure $PNPM_HOME/bin is in PATH
pnpm install -g @earendil-works/pi-coding-agent@latest
```

Verify:

```bash
which pi      # should be ~/.local/share/pnpm/bin/pi
pi --version
```

---

## Step 7 — Restore personal files

```bash
cp -r ~/pi-backup/agents        ~/.pi/agent/agents
cp -r ~/pi-backup/skills        ~/.pi/agent/skills
cp -r ~/pi-backup/extensions    ~/.pi/agent/extensions
cp ~/pi-backup/settings.json    ~/.pi/agent/settings.json
cp ~/pi-backup/auth.json        ~/.pi/agent/auth.json
cp ~/pi-backup/permissions.json ~/.pi/agent/permissions.json
```

---

## Step 8 — Reinstall extensions

```bash
pi update
```

Pi handles `--config.strict-dep-builds=false` internally, so the pnpm 11 build-scripts security gate is not an issue here.

Any MCP servers that used OAuth (e.g. Atlassian) will need to be re-authenticated — pi will prompt you on first use.

---

## NixOS-specific notes

- **Never run `pnpm setup`** — it tries to write a `package.json` next to the `pnpm` binary, which lives in the read-only Nix store (`/run/current-system/sw/bin/`).
- **`$PNPM_HOME/bin` vs `$PNPM_HOME`**: pnpm 11 moved the global bin directory from `$PNPM_HOME` to `$PNPM_HOME/bin`. If only the former is in PATH, globally installed binaries will silently appear but `pnpm` will report them as not found.
- pnpm itself should remain managed by Nix/nixpkgs, not installed via `pnpm setup`.

---

## Why `~/.pi/agent/npm/` exists

In older versions of pi, npm extensions (like `@diegopetrucci/pi-extensions`) were installed directly into pnpm's **global store**, which is why the directory was invisible. Pi now manages its own **isolated `~/.pi/agent/npm/` directory** to avoid conflicts with the user's global pnpm state. The old behaviour is still supported as a legacy fallback (`getLegacyGlobalNpmInstallPath` in the source).
