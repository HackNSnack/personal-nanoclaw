---
tags:
  - nixos
  - flatpak
  - nix-flatpak
  - declarative
type: reference
status: active
---

# Declarative Flatpak with nix-flatpak

**Context:** NixOS-Hyprland flake — some GUI apps (notably `bambu-studio`) cannot be built from nixpkgs source (GCC 15 incompatibility, no binary cache hit) and cannot be reliably wrapped as AppImages (missing SSL env vars, proprietary runtime plugin issues). The solution is Flatpak managed declaratively via `nix-community/nix-flatpak`, keeping the system fully reproducible from the flake.

---

## Why Flatpak for some apps

For most packages, nixpkgs + overlays is the right approach. But a small category of apps falls outside that:

| Symptom | Root cause | Better solution |
|---|---|---|
| C++ GUI app takes hours to compile, kills RAM | No binary cache hit on Hydra (build fails or simply never ran) | Flatpak |
| AppImage launches but TLS/networking fails | `SSL_CERT_FILE` / `CURL_CA_BUNDLE` not injected; `appimageTools.wrapType2` doesn't do this automatically | Flatpak |
| App downloads a proprietary `.so` plugin at runtime | dlopen'd library can't resolve host paths; nix-ld helps but is brittle per-app | Flatpak |
| Upstream actively maintains a Flathub package | The Flathub maintainer handles all integration work | Flatpak |

### bambu-studio specifically

- **nixpkgs source build:** fails with GCC 15 (CGAL / boost::tuples issue confirmed in nixpkgs CI). `cache.nixos.org` returns 404 — Hydra never successfully built it for the current nixpkgs rev.
- **AppImage approach (tried, abandoned):** the AppImage itself launches, but:
  - `SSL_CERT_FILE` / `CURL_CA_BUNDLE` not set → "TLS not supported" on any network call
  - `libbambu_networking.so` is downloaded at runtime and dlopen'd — needs `libsecret` + proper host lib paths
  - `WEBKIT_DISABLE_COMPOSITING_MODE` / `WEBKIT_DISABLE_DMABUF_RENDERER` not set → OAuth login popup crashes
  - `LD_PRELOAD=libGLEW.so` missing → intermittent 3D viewport crash
  - All of these *are* fixable (nixpkgs's own `preFixup` sets them all), but it requires a `symlinkJoin` + `makeWrapper` re-wrap on top of `wrapType2`, and the networking plugin remains fragile
- **Flatpak (current approach):** maintained on Flathub by `@hadess` (the same person who fixed these exact issues upstream). Handles TLS, networking plugin, OAuth login correctly in its sandbox. Gets v2.7.x vs v02.05.00.67 in nixpkgs.

---

## Setup

### 1. Flake input (`flake.nix`)

```nix
inputs = {
  # ...
  nix-flatpak.url = "github:gmodena/nix-flatpak";
};
```

### 2. NixOS module (`flake.nix` modules list)

```nix
modules = [
  # ...
  inputs.nix-flatpak.nixosModules.nix-flatpak
];
```

### 3. Package declaration (`hosts/default/config.nix`)

```nix
services.flatpak = {
  enable = true;
  # Declarative Flatpak — nix-flatpak installs/removes these on every
  # nixos-rebuild switch, so the system is fully reproducible.
  packages = [
    { appId = "com.bambulab.BambuStudio"; origin = "flathub"; }
  ];
};
```

The existing `systemd.services.flatpak-repo` service (which adds the Flathub remote on boot) is still required and stays in place.

### 4. Lock the new input

```bash
nix flake update nix-flatpak
```

### 5. Rebuild

```bash
rebuild  # nh os switch -H default .
```

nix-flatpak installs a `flatpak-managed-install.service` systemd unit that runs on activation and installs/removes packages to match the declared list.

---

## Adding more Flatpak apps

1. Find the App ID on [flathub.org](https://flathub.org) (shown on each app's page)
2. Add an entry to `services.flatpak.packages` in `hosts/default/config.nix`:

```nix
packages = [
  { appId = "com.bambulab.BambuStudio"; origin = "flathub"; }
  { appId = "org.videolan.VLC";          origin = "flathub"; }  # example
];
```

3. `rebuild` — done.

Removing an app is the same: delete the entry, rebuild.

---

## Integration with NixOS / Hyprland

| Integration point | Status | Notes |
|---|---|---|
| Wayland / Hyprland | ✅ Works | Flatpak talks to `xdg-desktop-portal-hyprland` |
| App launchers (Rofi, Wofi, Fuzzel) | ✅ Works | Desktop entries in `/var/lib/flatpak/exports/share/applications/` |
| File access | ✅ Works | Via XDG portals |
| Network access | ✅ Works | Full network access by default |
| USB / printer access | ✅ Works | Via portal permissions |
| GTK theming (Catppuccin etc.) | ⚠️ Partial | Flatpak sandbox doesn't see Nix store themes. Irrelevant for apps with their own UI (BambuStudio, etc.) |
| System fonts from Nix store | ⚠️ Partial | May not be visible inside sandbox. Irrelevant for most apps. |
| `nix gc` managing app storage | ❌ No | Flatpak manages its own store in `/var/lib/flatpak/` — `nix gc` doesn't touch it |

---

## How nix-flatpak works under the hood

- On `nixos-rebuild switch`, nix-flatpak generates a `flatpak-state.json` in the Nix store listing the declared packages
- A systemd activation service (`flatpak-managed-install.service`) diffs the current Flatpak state against the declared state and calls `flatpak install` / `flatpak uninstall` as needed
- The Flathub remote must already exist — handled by the existing `flatpak-repo` service in `hosts/default/config.nix`

---

## Related

- [[Clients/Personal/AgentNotes/Reference/NixOS/Replacing Source-Built Packages with Pre-Built Binaries]] — When to use overlays vs AppImage vs Flatpak; moon worked example
- `hosts/default/config.nix` — where `services.flatpak.packages` is declared
- `flake.nix` — where the `nix-flatpak` input and module are wired in
- [nix-flatpak on GitHub](https://github.com/gmodena/nix-flatpak)
- [Flathub](https://flathub.org) — find App IDs here
