---
tags: [nixos, nixpkgs, debugging, flakes, nix-eval]
type: reference
status: active
---

# Debugging nixpkgs Evaluation Warnings & Insecure Packages

**Context:** NixOS-Hyprland flake — fixed a batch of evaluation warnings and a hard `nodejs-slim-20` insecure-package error that blocked installation.

---

## Part 1 — Evaluation Warnings (Renamed/Deprecated Packages)

These are the straightforward ones. nixpkgs emits them at eval time and tells you exactly what to change.

### How to find them

Grep your whole flake for the old names:

```bash
grep -rn "protonvpn-gui\|swww\|xorg\.lib\|catppuccin\.enable\|pnpm.*nodejs" --include="*.nix" .
```

For the xorg mass-rename, `grep -rn "xorg\.lib" --include="*.nix" .` gives you every occurrence at once.

### Fixes applied

| Warning | File | Change |
|---|---|---|
| `protonvpn-gui` renamed to `proton-vpn` | `modules/packages/privacy.nix` | Rename in package list |
| `swww` renamed to `awww` | `modules/packages.nix` | Rename in package list |
| `xorg.libX11` → `libx11`, etc. (14 packages) | `modules/nix-ld.nix` | Remove `xorg.` prefix, lowercase |
| `pnpm`: override `nodejs-slim` not `nodejs` | `modules/overlays.nix` | `.override { nodejs-slim = …; }` |
| catppuccin migration warning | `modules/theme.nix` | See below |

### xorg rename map

All xorg libs are now top-level nixpkgs attributes with lowercase names:

```
xorg.libX11        → libx11
xorg.libXScrnSaver → libxscrnsaver
xorg.libXcomposite → libxcomposite
xorg.libXcursor    → libxcursor
xorg.libXdamage    → libxdamage
xorg.libXext       → libxext
xorg.libXfixes     → libxfixes
xorg.libXi         → libxi
xorg.libXrandr     → libxrandr
xorg.libXrender    → libxrender
xorg.libXtst       → libxtst
xorg.libxcb        → libxcb
xorg.libxkbfile    → libxkbfile
xorg.libxshmfence  → libxshmfence
```

### catppuccin/nix migration

The catppuccin module is migrating its API:
- `catppuccin.enable` is becoming a **global on/off switch** (was per-port toggle)
- `catppuccin.autoEnable` is the new control for auto-enrolling all supported ports

The warning says: *set `catppuccin.autoEnable` to match your current value of `catppuccin.enable`, then set `catppuccin.enable = true`.*

Since no ports were explicitly enabled, `autoEnable = false` preserves the opt-in behaviour:

```nix
# modules/theme.nix
catppuccin = {
  enable = true;      # global switch — must be true under the new API
  autoEnable = false; # don't auto-theme all ports; keep opt-in behaviour
};
```

---

## Part 2 — The Hard One: `nodejs-slim-20` Insecure Package Error

This was more involved. The error itself was clear but the *source* was not:

```
error: Refusing to evaluate package 'nodejs-slim-20.20.2' … because it is marked as insecure
```

### Step 1 — Rule out your own config

The first thing to check: is it something you explicitly wrote?

```bash
grep -rn "nodejs_20\|nodejs-slim_20\|nodejs-slim-20" --include="*.nix" .
```

Result: **nothing**. The config doesn't reference nodejs-slim-20 anywhere. So a package is pulling it in as a transitive dependency.

### Step 2 — Verify the known fix actually worked

The overlay already had a pnpm fix. Before hunting further, verify it actually took effect:

```bash
nix eval --extra-experimental-features 'nix-command flakes' \
  '.#nixosConfigurations.default.pkgs.pnpm.nodejs-slim.name'
```

Returned `"nodejs-slim-22.22.3"` — pnpm was fine. The problem is elsewhere.

### Step 3 — Understand the flake lock structure

The error trace named the store path containing the bad nixpkgs source (`gw7fxaw8z5szcqlzyzcnrshzi60zj664-source`). That store path contains `nixos/release.nix`, which told us it was a nixpkgs source. Reading `lib/trivial.nix` inside it confirmed version `26.11`.

To understand which nixpkgs revisions are in play, inspect the lock:

```bash
python3 -c "
import json
with open('flake.lock') as f:
    lock = json.load(f)
for name, node in lock['nodes'].items():
    if 'locked' in node and node['locked'].get('repo') == 'nixpkgs':
        print(name, node['locked']['rev'][:12], node['locked']['narHash'][:30])
"
```

This revealed **six different nixpkgs instances** in the lock:

| Lock node | Rev | Used by |
|---|---|---|
| `nixpkgs_5` | `9ae611a455b9` | root (main pkgs) |
| `nixpkgs-latest` | `9ae611a455b9` | `pkgs-latest` in flake.nix |
| `nixpkgs_2` | `b4262d9cfe38` | alejandra |
| `nixpkgs_3` | `9eac87a12312` | claude-code |
| `nixpkgs_4` | `9eac87a12312` | neovim-nightly |
| `nixpkgs` | `574d1eac1c20` | ags |

Critical insight: **`root.inputs.nixpkgs` maps to `nixpkgs_5`, not `nixpkgs_2`**. Confirm by reading the root node directly:

```bash
python3 -c "
import json
with open('flake.lock') as f: lock = json.load(f)
print(lock['nodes']['root']['inputs'])
"
```

The system derivation name `nixos-system-default-26.11.20260610.9ae611a` confirms this — `9ae611a` is the rev suffix from `nixpkgs_5`.

### Step 4 — Narrow down suspects

The overlay only overrides the `nodejs-slim` *alias* attribute. It doesn't affect packages that reference `nodejs-slim_20` directly by that name. Likely culprits: any GUI app that was built or depends on a fixed Node 20 version.

Check each suspect's `nativeBuildInputs` with a one-liner:

```bash
for pkg in zoom-us redisinsight azuredatastudio bambu-studio teams-for-linux; do
  result=$(NIXPKGS_ALLOW_INSECURE=1 nix eval --impure \
    --extra-experimental-features 'nix-command flakes' \
    ".#nixosConfigurations.default.pkgs.$pkg" \
    --apply 'p: builtins.concatStringsSep "," (map (x: x.name or "?") \
      ((p.buildInputs or []) ++ (p.nativeBuildInputs or [])))' 2>/dev/null)
  echo "$pkg: $result" | grep -i "node\|slim" || echo "$pkg: (no node deps)"
done
```

Output:
```
zoom-us: (no node deps)
redisinsight: "…nodejs-slim-20.20.2,nodejs-slim-20.20.2…"
azuredatastudio: (no node deps)
bambu-studio: (no node deps)
teams-for-linux: "nodejs-24.15.0…"
```

**`redisinsight` is the culprit.**

### Step 5 — Understand why the overlay didn't catch it

Look at how nixpkgs declares `redisinsight`:

```bash
cat /nix/store/<nixpkgs-source>/pkgs/by-name/re/redisinsight/package.nix | head -20
```

```nix
{ lib, stdenv, …, nodejs-slim_20, … }:
let nodejs = nodejs-slim_20;
```

The package takes `nodejs-slim_20` as a **direct `callPackage` function argument** — not via the `nodejs-slim` alias. The overlay's `nodejs-slim = final.nodejs-slim_22` only reassigns the alias; packages that ask for `nodejs-slim_20` by name bypass it entirely.

### Step 6 — The fix: `.override {}` on the callPackage argument

Since `redisinsight` is a `callPackage`-based package, its function arguments can be swapped with `.override`:

```nix
# modules/overlays.nix
redisinsight = prev.redisinsight.override { nodejs-slim_20 = final.nodejs-slim_22; };
```

This tells nixpkgs: whenever `redisinsight`'s `callPackage` scope resolves `nodejs-slim_20`, substitute `nodejs-slim_22` instead. No `permittedInsecurePackages` needed.

Verify it took effect:

```bash
nix eval --extra-experimental-features 'nix-command flakes' \
  '.#nixosConfigurations.default.pkgs.redisinsight.nativeBuildInputs' \
  --apply 'ps: map (p: p.name) ps'
# → [ … "nodejs-slim-22.22.3" … ]
```

Final sanity check — full eval without `NIXPKGS_ALLOW_INSECURE`:

```bash
nix eval --extra-experimental-features 'nix-command flakes' \
  '.#nixosConfigurations.default.config.system.build.toplevel.drvPath'
# → "/nix/store/…-nixos-system-default-….drv"  (no error)
```

---

## Key Techniques Reference

### Inspect a package's build inputs without building

```bash
nix eval --extra-experimental-features 'nix-command flakes' \
  '.#nixosConfigurations.default.pkgs.<name>.nativeBuildInputs' \
  --apply 'ps: map (p: p.name) ps'
```

### Verify a package attribute (e.g. which node version pnpm uses)

```bash
nix eval … '.#nixosConfigurations.default.pkgs.pnpm.nodejs-slim.name'
```

### Read the flake lock to map input names → nixpkgs revs

```bash
python3 -c "
import json
with open('flake.lock') as f: lock = json.load(f)
print('root inputs:', lock['nodes']['root']['inputs'])
for n, node in lock['nodes'].items():
    if node.get('locked',{}).get('repo') == 'nixpkgs':
        print(n, node['locked']['rev'][:12])
"
```

### Trace which inputs pull in extra nixpkgs (reverse map)

```bash
python3 -c "
import json
with open('flake.lock') as f: lock = json.load(f)
for name, node in lock['nodes'].items():
    for k, v in node.get('inputs', {}).items():
        if isinstance(v, str) and 'nixpkgs' in v:
            print(f'{name} → {v} (key: {k})')
"
```

### Override a callPackage argument in an overlay

When a package uses `{ …, someArg, … }:` as a direct function parameter:
```nix
# This works — swaps the callPackage argument
myPackage = prev.myPackage.override { someArg = final.replacementValue; };

# This does NOT work — only reassigns the alias in the package set
someArg = final.replacementValue;  # ← packages that ask for someArg by name won't see this
```

---

## Related

- [[Clients/Personal/AgentNotes/Reference/NanoClaw/NanoClaw NixOS Setup]] — NixOS config reference
- `modules/overlays.nix` — where the pnpm + redisinsight overrides live
- `modules/nix-ld.nix` — where the xorg → top-level lib renames were applied
- `modules/theme.nix` — where the catppuccin migration options live
