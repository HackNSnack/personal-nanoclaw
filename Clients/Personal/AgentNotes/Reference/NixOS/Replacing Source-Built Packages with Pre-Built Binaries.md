---
tags: [nixos, nixpkgs, overlays, performance, appimage, binary-cache]
type: reference
status: active
---

# Replacing Source-Built Packages with Pre-Built Binaries

**Context:** NixOS-Hyprland flake — some packages have no entry in the binary cache (or are pinned to a custom version) and will always compile from source. Large compilations (Rust toolchains, C++ GUI apps) can consume 4–8 GB of RAM each and freeze the machine when combined with `max-jobs = auto`. This guide shows how to swap them out for pre-built binaries without changing any package names in the rest of the config.

---

## How it works

The overlay in `modules/overlays.nix` intercepts package lookups before they reach nixpkgs. If you define `bambu-studio` in the overlay, every module that writes `pkgs.bambu-studio` gets your version — no changes needed anywhere else in the config.

Two patterns cover almost every case:

| Package type | Pattern | Nix tool |
|---|---|---|
| Single static binary (Go, musl Rust) | `fetchurl` + `mkDerivation` | plain copy to `$out/bin` |
| Dynamic binary / full app | AppImage | `pkgs.appimageTools.wrapType2` |

---

## Step 1 — Confirm the package is actually compiling from source

Before doing anything, verify the package isn't already being substituted from cache. Run a dry-run and look for `building` vs `fetching`:

```bash
cd ~/NixOS-Hyprland
nh os build -H default .   # or: nixos-rebuild dry-build --flake .#default
```

Alternatively, check how nixpkgs defines the package — if it has a `cargoDeps`, `vendorHash`, or a large `buildInputs` list with compilers, it builds from source:

```bash
# Find the package.nix in the nix store (no download needed)
nix eval --extra-experimental-features 'nix-command flakes' \
  '.#nixosConfigurations.default.pkgs.<name>.src.url' 2>/dev/null
```

If there's no `.url` (it came from `fetchFromGitHub`, `fetchgit`, etc.), it's source. If it has a `.url` pointing to a `.tar.gz` full of source code, same deal.

---

## Step 2 — Find the official pre-built release

Almost every serious open-source project ships pre-built binaries on its GitHub releases page. The goal is to find one that's either:
- **Statically linked** (musl, Go) — works on any Linux, no patching needed
- **An AppImage** — self-contained, works on any Linux via `appimage-run`

### How to read a GitHub releases page

1. Go to `https://github.com/<owner>/<repo>/releases/latest`
2. Expand **Assets** at the bottom
3. Look for filenames matching:

```
# Static binaries (prefer musl over gnu when both exist):
<name>-x86_64-unknown-linux-musl.tar.gz   ← best: fully static
<name>-x86_64-unknown-linux-gnu.tar.gz    ← also fine, needs autoPatchelfHook
<name>-linux-amd64                        ← Go binaries, fully static
<name>-x86_64-linux                       ← generic Linux

# AppImages:
<Name>-x86_64.AppImage
<Name>_ubuntu22.04-<version>.AppImage     ← prefer 22.04 over 24.04 for compat
```

4. If a `.sha256` or `.sha256sum` file is listed next to the binary, grab it — you'll need it for the hash.

### Using the GitHub API to list assets without a browser

```bash
curl -sL "https://api.github.com/repos/<owner>/<repo>/releases/latest" \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
print('Tag:', data['tag_name'])
for a in data['assets']:
    print(' ', a['name'])
"
```

---

## Step 3 — Get the Nix hash

Nix uses SRI hashes (`sha256-<base64>`). There are two routes depending on whether the project ships a checksum file.

### Route A — project ships a `.sha256` file (fastest)

```bash
# 1. Download the hex checksum the project provides
HEX=$(curl -sL "https://github.com/<owner>/<repo>/releases/download/<tag>/<file>.sha256" \
  | awk '{print $1}')

# 2. Convert hex → SRI base64
echo "sha256-$(echo "$HEX" | xxd -r -p | base64 -w0)"
```

### Route B — no checksum file (stream and hash on the fly)

This downloads the file but doesn't write it to disk:

```bash
curl -sL "<full-download-url>" | sha256sum | awk '{print $1}' \
  | xargs -I{} sh -c 'echo "sha256-$(echo {} | xxd -r -p | base64 -w0)"'
```

> **Tip:** For AppImages this can take a minute (200–300 MB). Run it once, paste the result into the overlay, and you're done until the next version.

---

## Step 4 — Write the overlay

All overrides go into the big `(final: prev: rec { … })` block in `modules/overlays.nix`.

### Pattern A — static single binary

Use this for tools that ship as a single executable (Go, musl Rust, etc.).

```nix
# modules/overlays.nix — inside (final: prev: rec { … })

myTool = final.stdenv.mkDerivation rec {
  pname = "my-tool";
  version = "1.2.3";
  src = final.fetchurl {
    url = "https://github.com/<owner>/<repo>/releases/download/v${version}/<file>-x86_64-unknown-linux-musl.tar.gz";
    hash = "sha256-<SRI hash here>";
  };
  # musl = statically linked, no extra deps or autoPatchelfHook needed
  dontConfigure = true;
  dontBuild = true;
  installPhase = ''
    runHook preInstall
    # Adjust the path to match what's actually in the tarball (check with: tar -tJ <file>)
    install -Dm755 <binary-name> $out/bin/<binary-name>
    runHook postInstall
  '';
  meta = with final.lib; {
    description = "…";
    homepage = "https://…";
    license = licenses.mit;
    platforms = [ "x86_64-linux" ];
    mainProgram = "<binary-name>";
  };
};
```

> **Dynamic glibc binary?** Add `nativeBuildInputs = [ final.autoPatchelfHook ];` and list required `.so` libraries under `buildInputs`. The hook will rewrite the `RUNPATH` automatically.

### Pattern B — AppImage

Use this for GUI applications that ship as AppImages.

```nix
# modules/overlays.nix — inside (final: prev: rec { … })

myApp = final.appimageTools.wrapType2 {
  pname = "my-app";
  version = "1.2.3";
  src = final.fetchurl {
    url = "https://github.com/<owner>/<repo>/releases/download/v<version>/<Name>_ubuntu22.04-<version>.AppImage";
    hash = "sha256-<SRI hash here>";
  };
};
```

`appimageTools.wrapType2` handles everything: extracting the AppImage, patching ELF headers, and creating a launcher in `$out/bin`.

> **Type 1 vs Type 2?** The vast majority of modern AppImages are Type 2. If `wrapType2` gives an error about the AppImage format, try `wrapType1` instead.

### Diagnosing missing libraries after install

If the app launches with a `cannot open shared object file` error, the AppImage doesn't bundle that library and expects to find it on the host. Scan for *all* missing libraries in one pass before iterating:

```bash
find /nix/store/*<pname>*extracted* -type f \
  | xargs ldd 2>/dev/null \
  | grep 'not found' \
  | awk '{print $1}' \
  | sort -u
```

This gives you every missing `.so` at once. Then map each to its nixpkgs package and add them all to `extraPkgs` together.

> **FFmpeg ABI warning:** `ffmpeg` in nixpkgs 26.05 is v8 (`libavcodec.so.62`). AppImages built against Ubuntu 22.04 typically link against FFmpeg 7 (`libavcodec.so.61`). If you see ffmpeg libs in the missing list, use `ffmpeg_7` — not `ffmpeg`.

---

## Step 5 — Verify the tarball contents before writing the overlay

Before writing the `installPhase`, check exactly what path the binary sits at inside the archive:

```bash
# For .tar.gz / .tar.xz:
curl -sL "<url>" | tar -tJ   # xz
curl -sL "<url>" | tar -tz   # gz

# Example output:
# moon_cli-x86_64-unknown-linux-musl/
# moon_cli-x86_64-unknown-linux-musl/moon    ← this is what you install
# moon_cli-x86_64-unknown-linux-musl/README.md
```

With `mkDerivation`, the tarball is auto-unpacked and `$src` becomes the top-level extracted directory, so you reference `moon` not `moon_cli-.../moon`.

---

## Step 6 — Rebuild

```bash
cd ~/NixOS-Hyprland
rebuild   # alias for: nh os switch -H default .
```

During the build you should now see `fetching` (binary download) instead of `building` for the replaced packages.

---

## Updating a pinned package to a new version

### Static binary

1. Find the new version tag on GitHub releases
2. Get the new SRI hash (Route A or B from Step 3)
3. Bump `version` and `hash` in the overlay — the URL uses `${version}` so it updates automatically

### AppImage

The Bambu Studio AppImage URL contains a datestamp in the filename (e.g. `20260616195227`). When a new release comes out, both the version number *and* the datestamp change, so you need to update both the `version` and the full `url`.

```bash
# 1. Find new AppImage URL from the releases API
curl -sL "https://api.github.com/repos/bambulab/BambuStudio/releases/latest" \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
print('Tag:', data['tag_name'])
for a in data['assets']:
    if 'ubuntu22.04' in a['name'] and a['name'].endswith('.AppImage'):
        print('URL:', a['browser_download_url'])
"

# 2. Hash it
curl -sL "<new-url>" | sha256sum | awk '{print $1}' \
  | xargs -I{} sh -c 'echo "sha256-$(echo {} | xxd -r -p | base64 -w0)"'

# 3. Update both url and hash in modules/overlays.nix, then rebuild
```

---

## Packages already converted

### `moon` — monorepo build tool

- **Problem:** nixpkgs 26.05 ships v1.x; the overlay needed v2.x, which was compiled from Rust source (4–8 GB RAM, 20–60 min)
- **Solution:** Official pre-built musl binary from [moonrepo/moon releases](https://github.com/moonrepo/moon/releases)
- **Binary type:** Static (musl) — no patching needed
- **Pattern:** Pattern A (static binary)
- **Current version:** 2.1.1
- **Hashes:**

```
URL:  https://github.com/moonrepo/moon/releases/download/v2.1.1/moon_cli-x86_64-unknown-linux-musl.tar.xz
SHA256 (hex):  0eb06d7295f994620b4bd778803c6ba62a4cf5ea7310ae6ad57392c6a8bfeaa8
SRI:           sha256-DrBtcpX5lGILS9d4gDxrpipM9epzEK5q1XOSxqi/6qg=
```

---

### `bambu-studio` — Bambu Lab 3D printing slicer

> **⚠️ Moved to Flatpak (2026-06-16).** The AppImage approach was attempted but abandoned due to unresolvable runtime integration issues. See [[Clients/Personal/AgentNotes/Reference/NixOS/Declarative Flatpak with nix-flatpak]] for the current setup.

**Why the AppImage approach failed:**
- `appimageTools.wrapType2` does not inject `SSL_CERT_FILE` / `CURL_CA_BUNDLE` → "TLS not supported" on every network call
- `libbambu_networking.so` is downloaded at runtime and dlopen'd — required `libsecret` + correct host lib resolution that nix-ld couldn't reliably provide
- Missing `WEBKIT_DISABLE_COMPOSITING_MODE=1` / `WEBKIT_DISABLE_DMABUF_RENDERER=1` → OAuth login popup crashes
- All fixable via a `symlinkJoin` + `makeWrapper` re-wrap, but the networking plugin remained fragile

**Why nixpkgs source build is also not viable:**
- Fails to compile with GCC 15 (CGAL / boost::tuples issue — confirmed in nixpkgs CI for nixos-unstable)
- `cache.nixos.org` returns 404 for the current nixpkgs rev — Hydra never built it successfully
- Would require forcing `gcc14Stdenv`, meaning it never gets a cache hit and recompiles on every nixpkgs bump

**Current solution:** Declared as a Flatpak package via `nix-flatpak`. Maintained on Flathub by `@hadess` who handles all TLS, networking plugin, and OAuth integration correctly.

**Historical AppImage hashes (for reference only):**
```
URL:  https://github.com/bambulab/BambuStudio/releases/download/v02.07.01.62/BambuStudio_ubuntu22.04-v02.07.01.62-20260616195227.AppImage
SHA256 (hex):  2749917af560f3b9a2681429da9c43d00c65d096e1a1c479cc49466634174549
SRI:           sha256-J0mRevVg87miaBQp2pxD0Axl0JbhocR5zElGZjQXRUk=
```

---

## Related

- [[Clients/Personal/AgentNotes/Reference/NixOS/Debugging nixpkgs Evaluation Warnings & Insecure Packages]] — Tracing renamed packages, transitive insecure deps, `callPackage` override technique
- [[Clients/Personal/AgentNotes/Reference/NixOS/Declarative Flatpak with nix-flatpak]] — When overlays/AppImages aren't viable; declarative Flatpak setup with nix-flatpak
- `modules/overlays.nix` — where all overlay overrides defined in this guide live
- `modules/packages/misc.nix` — where `moon` is listed (`bambu-studio` moved to Flatpak)
