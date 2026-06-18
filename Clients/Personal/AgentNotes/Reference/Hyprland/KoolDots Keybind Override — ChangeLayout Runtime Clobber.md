---
tags:
  - hyprland
  - keybinds
  - kooldots
  - dotfiles
  - debugging
type: reference
status: active
---

# KoolDots Keybind Override — ChangeLayout Runtime Clobber

**Context:** After upgrading the KoolDots (formerly JaKooLit) Hyprland-Dots repo to the new upstream owner (`LinuxBeginnings`), vim-style `SUPER+HJKL` window navigation defined in `UserKeybinds.conf` stopped working. `SUPER+J` and `SUPER+K` were silently reverting to `cyclenext`/`cyclenext,prev` at every startup and every layout switch, despite correct `unbind` + `bindd` overrides being present in the user config.

---

## File Map

| File | Role |
|---|---|
| `configs/Keybinds.conf` | Upstream default keybinds, sourced first |
| `UserConfigs/UserKeybinds.conf` | User overrides, sourced last |
| `hyprland.conf` | Root config — defines source order |
| `configs/Startup_Apps.conf` | Default startup `exec-once` entries |
| `scripts/ChangeLayout.sh` | Runtime layout switcher (master/dwindle/scrolling/monocle) |
| `scripts/KeybindsLayoutInit.sh` | Startup shim — was initialising J/K binds |

---

## How the Problem Was Investigated

### Step 1 — Read all relevant files

Started by reading `UserKeybinds.conf`, `ChangeLayout.sh`, `Keybinds.conf`, `hyprland.conf`, `Startup_Apps.conf`, and `KeybindsLayoutInit.sh` in full to understand the complete picture before forming any hypothesis.

### Step 2 — Establish the source load order

`hyprland.conf` sources files in this order:

```
source=$configs/Keybinds.conf           ← 1. upstream binds (registers exec-once scripts)
source=$configs/Startup_Apps.conf       ← 2. startup apps (registers KeybindsLayoutInit.sh)
...
source=$UserConfigs/UserKeybinds.conf   ← LAST: user overrides
```

This means `UserKeybinds.conf` is parsed last and its `unbind`/`bindd` lines **do** win at config-parse time. The static layer was correct.

### Step 3 — Identify the runtime layer

The bug was not in config parsing — it was in two `exec-once` scripts that fire **after** all `.conf` files have been parsed, using `hyprctl keyword` to set runtime binds that override anything from static config:

**`Keybinds.conf` line 112:**
```bash
exec-once = $scriptsDir/ChangeLayout.sh init
```

**`Startup_Apps.conf` line 58:**
```bash
exec-once = $scriptsDir/KeybindsLayoutInit.sh
```

`hyprctl keyword` operates on Hyprland's live runtime state. It does not care what the `.conf` files say — it overwrites them.

### Step 4 — Read the offending script bodies

`ChangeLayout.sh`'s `set_layout()` function contained this block, which ran **unconditionally for every layout** (including `init`, `toggle`, and direct layout selection):

```bash
hypr_keyword unbind SUPER,j
hypr_keyword unbind SUPER,k
hypr_keyword bind SUPER,j,cyclenext        # ← nukes movefocus,d
hypr_keyword bind SUPER,k,cyclenext,prev   # ← nukes movefocus,u
```

`KeybindsLayoutInit.sh` (entire functional body):

```bash
hyprctl keyword unbind SUPER,j || true
hyprctl keyword unbind SUPER,k || true
hyprctl keyword bind SUPER,j,cyclenext        # ← same clobber
hyprctl keyword bind SUPER,k,cyclenext,prev
```

### Step 5 — Git archaeology

Ran `git log --oneline --follow` on both scripts to trace their history, then `git show <hash>` on each significant commit. Key findings:

#### Original `ChangeLayout.sh` (JaKooLit era, `a1fa450d`)

The original script was a simple master ↔ dwindle toggle. The J/K rebinding was **genuinely necessary** at the time: early Hyprland had different dispatcher behaviour between layouts — `cyclenext` ping-ponged focus in master layout, so the script swapped to `layoutmsg,cyclenext` when switching to master. This was legitimate environment-aware logic.

#### `KeybindsLayoutInit.sh` original form

The original version also had real purpose: it detected the current layout at startup and set J/K to the appropriate dispatcher (`cyclenext` vs `layoutmsg,cyclenext`). It handled the edge case of Hyprland starting into an already-configured layout that needed the right dispatcher.

#### Commit `0a9484f3` — "Fixed SUPER J/K ping ponging"

This was the turning point. The layout-specific dispatcher distinction was collapsed: J/K were simplified to always use `cyclenext` globally, removing the per-layout branching. `KeybindsLayoutInit.sh` was gutted to 3 functional lines. The comment added was: *"This avoids double-actions when layouts change."* The layout-awareness was gone; both scripts now just enforced a single static preference at runtime.

#### Commit `e4b9059d` — "Updating Hyprland to v2.3.22"

Expanded layout support from 2 layouts to 4 (added scrolling, monocle). Arrow key rebinding per-layout was added (still genuinely useful — monocle/scrolling need `layoutmsg,cyclenext` on arrows, not `movefocus`). J/K management was back in the per-layout case arms but still collapsed to `cyclenext` for all non-master layouts. Further iterations within the same squash commit ultimately landed on J/K being set unconditionally before the case statement — same result for all layouts.

---

## Root Cause Summary

Three compounding issues:

### 1. `ChangeLayout.sh init` overwrites J/K at startup

**Sequence:**
1. Hyprland parses `Keybinds.conf` → J/K bound to `cyclenext` (static)
2. Hyprland parses `UserKeybinds.conf` → J/K unbound, rebound to `movefocus` ✅
3. `exec-once` fires → `ChangeLayout.sh init` runs → `hyprctl keyword` forces J/K back to `cyclenext` ❌

### 2. `KeybindsLayoutInit.sh` does the same thing again

Runs from `exec-once` in `Startup_Apps.conf` immediately after `ChangeLayout.sh init`. Both scripts clobber J/K independently, so J/K are overwritten twice at every startup.

### 3. Every layout switch re-clobbers J/K

Every call to `ChangeLayout.sh` (via `SUPER+ALT+1/2/3/4`) re-runs `set_layout()`, which unconditionally resets J/K. Even a workaround applied at startup would be broken again on the first layout switch.

### Why H and L were unaffected

`SUPER+H` and `SUPER+L` were only handled by static config. Neither `ChangeLayout.sh` nor `KeybindsLayoutInit.sh` ever touched those keys. The static `unbind`+`bindd` in `UserKeybinds.conf` worked correctly for them because nothing overwrote them at runtime.

---

## What `ChangeLayout.sh` Actually Does (and What It Doesn't)

### Genuine environment-aware logic (worth keeping)

- Queries live Hyprland state via `hyprctl -j getoption general:layout` to determine the current layout
- **Rebinds arrow keys per-layout** — Hyprland `.conf` has no conditional bind syntax, so this cannot be replicated statically. Monocle and scrolling layouts stack windows; `layoutmsg,cyclenext` is the correct dispatcher for arrows in those modes, not `movefocus`
- Manages `SUPER+O` (togglesplit) — only meaningful in dwindle
- `init` applies the correct arrow-key binds at startup for whatever layout is configured as default, without hardcoding it
- Has a fallback for Hyprland's non-legacy Lua config parser (`hyprctl eval "hl.config(...)"` when `hyprctl keyword` returns a parser error)

### Glorified config wrapped in a script (was the problem)

- The J/K lines: after the "ping ponging" fix, they became a static preference (`cyclenext` for all layouts) run dynamically. Functionally equivalent to a `bindd` line in `Keybinds.conf`, but executed after config parsing so they trampled user overrides

### `KeybindsLayoutInit.sh` verdict

Fully redundant in its current form. `ChangeLayout.sh init` already runs at startup and handles everything `KeybindsLayoutInit.sh` was doing. The original version had independent value (layout detection); after the simplification it became a duplicate startup shim with no independent purpose.

---

## Fix Applied

### 1. Stripped J/K lines from `ChangeLayout.sh`

Removed four lines from `set_layout()` in `scripts/ChangeLayout.sh`:

```bash
# REMOVED — these four lines:
hypr_keyword unbind SUPER,j
hypr_keyword unbind SUPER,k
hypr_keyword bind SUPER,j,cyclenext
hypr_keyword bind SUPER,k,cyclenext,prev
```

The script still switches layouts, rebinds arrow keys per-layout, manages `SUPER+O`, sends notifications, and runs correctly on `init`. It just no longer touches J or K.

### 2. Removed `KeybindsLayoutInit.sh` exec-once from `Startup_Apps.conf`

```bash
# REMOVED from configs/Startup_Apps.conf:
exec-once = $scriptsDir/KeybindsLayoutInit.sh
```

### 3. Deleted `KeybindsLayoutInit.sh`

Confirmed no remaining references anywhere in the config before deleting. The file `scripts/KeybindsLayoutInit.sh` was removed entirely.

### Result

`UserKeybinds.conf`'s static `unbind`+`bindd` overrides now win cleanly. Nothing overwrites J/K at runtime. All four HJKL layers (plain, CTRL, ALT, SHIFT) function as configured:

| Combo | Action |
|---|---|
| `SUPER+H/J/K/L` | `movefocus l/d/u/r` |
| `SUPER+CTRL+H/J/K/L` | `movewindow l/d/u/r` |
| `SUPER+ALT+H/J/K/L` | `swapwindow l/d/u/r` |
| `SUPER+SHIFT+H/J/K/L` | `resizeactive` |

---

## Key Insight: Static Config vs Runtime `hyprctl keyword`

Hyprland processes `.conf` files at startup in source order, building a bind table. `hyprctl keyword bind` writes directly to the live runtime bind table **after** that parse phase is complete. Any `exec-once` that uses `hyprctl keyword bind` will therefore overwrite whatever the `.conf` files set, regardless of source order. `unbind`/`bindd` in `UserKeybinds.conf` cannot defend against this — they operate in a different phase.

This is the general pattern to watch for: if a keybind override in `UserKeybinds.conf` doesn't stick, look for `exec-once` scripts that call `hyprctl keyword bind` or `hyprctl keyword unbind` for that key.

---

## Related

- `configs/Keybinds.conf` — upstream default binds; source of J/K `cyclenext` static binds
- `UserConfigs/UserKeybinds.conf` — user overrides; where HJKL movefocus binds live
- `scripts/ChangeLayout.sh` — layout switcher; still active, J/K lines removed
- `hyprland.conf` — root config; defines source order and registers `ChangeLayout.sh init` exec-once
- [[Clients/Personal/AgentNotes/Reference/NixOS/Debugging nixpkgs Evaluation Warnings & Insecure Packages]] — similar archaeology methodology applied to NixOS package tracing
