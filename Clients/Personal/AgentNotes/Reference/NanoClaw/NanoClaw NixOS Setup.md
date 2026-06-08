---
tags:
  - nanoclaw
  - nixos
  - flake
  - docker
  - onecli
  - selfhosted
type: reference
status: active
---

# NanoClaw NixOS Setup

**Purpose:** Full configuration map for running NanoClaw on NixOS. `nanoclaw.sh` assumes a conventional Linux distro with dynamic installs (`apt`, `curl | sh`). On NixOS everything must be declared. This note documents what each setup step actually does and exactly where to declare it.

**Last updated:** 2025-06-13
**Repo:** fork of `nanocoai/nanoclaw` (v2)

---

## How `nanoclaw.sh` Works (Summary)

Two phases:

1. **`setup.sh` (bootstrap)** — installs Node 22, pnpm 10.33.0, runs `pnpm install --frozen-lockfile`, verifies `better-sqlite3` native module compiled.
2. **`pnpm run setup:auto`** — an interactive sequencer running these steps in order:

| Step | What it does |
|---|---|
| `environment` | Detects platform, Docker, existing config |
| `container` | Builds the agent Docker image from `container/Dockerfile` |
| `onecli` | Installs OneCLI gateway (Docker Compose stack) + CLI binary |
| `auth` | Registers Anthropic credential with OneCLI vault |
| `mounts` | Writes `~/.config/nanoclaw/mount-allowlist.json` |
| `service` | Compiles TypeScript, writes + starts a systemd user unit |
| `cli-agent` | Seeds the initial agent group into the SQLite database |
| `timezone` | Detects and persists timezone |
| `channel` | Optional: pairs Telegram, Discord, WhatsApp, etc. |
| `verify` | Confirms credentials, service, and channels are all wired up |

On NixOS, phases 1 and 2 cannot run as-is. Software installs are handled by Nix; the **configuration outputs** of each step must be declared instead.

---

## What Needs to Be Declared and Where

### 1. `flake.nix` — System-level

#### Docker service

```nix
virtualisation.docker.enable = true;
users.users.<youruser>.extraGroups = [ "docker" ];
```

**Why:** The host process (`dist/index.js`) calls `docker run` on every agent session. The daemon must be running and your user must reach the socket without sudo.

#### User lingering

```nix
users.users.<youruser>.linger = true;
```

**Why:** Without this, systemd kills all user processes (including nanoclaw and the OneCLI gateway) when your last login session closes. With linger, `default.target` user services keep running permanently.

#### OneCLI gateway service

The gateway is a Docker Compose stack (containers: `onecli` + `postgres`). The normal installer does `curl -fsSL onecli.sh/install | sh`. On NixOS, manage its lifecycle via a systemd service pointing at the compose file the installer drops:

```nix
systemd.services.onecli-gateway = {
  description = "OneCLI Gateway";
  after = [ "docker.service" "network.target" ];
  requires = [ "docker.service" ];
  wantedBy = [ "multi-user.target" ];
  serviceConfig = {
    Type = "simple";
    ExecStart = "${pkgs.docker-compose}/bin/docker-compose -f /opt/onecli/docker-compose.yml up";
    ExecStop  = "${pkgs.docker-compose}/bin/docker-compose -f /opt/onecli/docker-compose.yml down";
    Restart = "on-failure";
    WorkingDirectory = "/opt/onecli";
  };
};
```

Run the OneCLI installer once to get `/opt/onecli/docker-compose.yml`, then NixOS owns the service lifecycle from there.

---

### 2. Home-manager — User-level

#### Systemd user service

The unit name contains a hash of the project's **absolute path**, computed in `src/install-slug.ts`:

```ts
createHash('sha1').update(projectRoot).digest('hex').slice(0, 8)
```

Compute it:

```bash
echo -n "/absolute/path/to/nanoclaw" | sha1sum | cut -c1-8
# e.g. → ab12cd34
```

Declare the unit:

```nix
systemd.user.services."nanoclaw-v2-ab12cd34" = {
  Unit = {
    Description = "NanoClaw Personal Assistant";
    After = [ "network.target" ];
  };
  Service = {
    Type = "simple";
    ExecStart = "${pkgs.nodejs_22}/bin/node /absolute/path/to/nanoclaw/dist/index.js";
    WorkingDirectory = "/absolute/path/to/nanoclaw";
    Restart = "always";
    RestartSec = "5";
    KillMode = "process";
    Environment = [
      "HOME=/home/<youruser>"
      "PATH=${pkgs.nodejs_22}/bin:${pkgs.docker}/bin:/run/wrappers/bin:/run/current-system/sw/bin"
      "TZ=Your/IANA_Timezone"
    ];
    EnvironmentFile = "/run/secrets/nanoclaw-env";
    StandardOutput = "append:/absolute/path/to/nanoclaw/logs/nanoclaw.log";
    StandardError  = "append:/absolute/path/to/nanoclaw/logs/nanoclaw.error.log";
  };
  Install.WantedBy = [ "default.target" ];
};
```

**Why the slug matters:** nanoclaw stamps every spawned container with `--label nanoclaw-install=<slug>` and uses it to scope container cleanup to this checkout only. The service name must match what `src/install-slug.ts` would generate for your project path, otherwise peer-detection and container reaping break.

> `setup/service.ts` also runs `pnpm run build` before writing the unit. On NixOS you run this manually once — see [One-Time Bootstrap](#one-time-bootstrap).

#### Mount allowlist

```nix
home.file.".config/nanoclaw/mount-allowlist.json".text = builtins.toJSON {
  allowedRoots = [
    # Example:
    # { path = "/home/<youruser>/projects"; allowReadWrite = true; description = "Dev projects"; }
  ];
  blockedPatterns = [];
  nonMainReadOnly = true;
};
```

**Why:** `src/config.ts` reads this file on every container spawn to validate any `additionalMounts` from `container.json`. An empty `allowedRoots` is the safe default — the agent only sees what nanoclaw itself explicitly mounts (session DBs, group folder, shared source).

#### `ncl` CLI symlink

```nix
home.file.".local/bin/ncl" = {
  source = "/absolute/path/to/nanoclaw/bin/ncl";
};
```

**Why:** `ncl` / `pnpm run chat` is the CLI client for sending messages to the running service. `setup/service.ts` normally creates this symlink; this replaces it declaratively.

---

### 3. Secrets — `.env` File

`src/env.ts` reads from `.env` in the project root. `src/config.ts` uses these keys at runtime:

| Key | Required | Notes |
|---|---|---|
| `ONECLI_URL` | **Yes** | e.g. `http://localhost:10254` |
| `ONECLI_API_KEY` | Only for remote OneCLI | API key if gateway is on another machine |
| `ASSISTANT_NAME` | No | Default: `Andy` — sets the trigger word `@Andy` |
| `TZ` | No | IANA timezone, e.g. `Europe/Oslo`. Falls back to system TZ |
| `ANTHROPIC_BASE_URL` | No | Only for a custom API-compatible endpoint |

**With sops-nix or agenix** (recommended), render a secret as an env file and reference it:

```nix
Service.EnvironmentFile = "/run/secrets/nanoclaw-env";
```

Secret contents:

```
ONECLI_URL=http://localhost:10254
ASSISTANT_NAME=Andy
TZ=Europe/Oslo
```

**Without a secrets manager**, write `.env` manually once after OneCLI is running:

```bash
echo "ONECLI_URL=http://localhost:10254" >> /path/to/nanoclaw/.env
echo "TZ=Europe/Oslo" >> /path/to/nanoclaw/.env
```

---

### 4. OneCLI CLI Binary

The `onecli` binary (v1.3.0, Go binary) must be on PATH. Package it as a derivation:

```nix
onecli-cli = pkgs.stdenv.mkDerivation rec {
  pname = "onecli-cli";
  version = "1.3.0";
  src = pkgs.fetchurl {
    url = "https://github.com/onecli/onecli-cli/releases/download/v${version}/onecli_${version}_linux_amd64.tar.gz";
    hash = "sha256-AAAAAAA="; # nix-prefetch-url <url> to get this
  };
  nativeBuildInputs = [ pkgs.autoPatchelfHook ];
  installPhase = ''
    mkdir -p $out/bin
    tar -xzf $src -C $out/bin onecli
    chmod +x $out/bin/onecli
  '';
};
```

Get the hash:

```bash
nix-prefetch-url https://github.com/onecli/onecli-cli/releases/download/v1.3.0/onecli_1.3.0_linux_amd64.tar.gz
```

Then add `onecli-cli` to `environment.systemPackages`.

---

## One-Time Bootstrap

Run these once after `nixos-rebuild switch`, from inside the project:

```bash
cd /absolute/path/to/nanoclaw

# 1. JS deps + compiles better-sqlite3 native module
pnpm install --frozen-lockfile

# 2. Compile TypeScript → dist/
pnpm run build

# 3. Create logs directory (service won't start without it)
mkdir -p logs

# 4. Build the agent Docker image (3–10 min first time)
cd container
docker build -t nanoclaw-agent-v2-ab12cd34:latest .
cd ..

# 5. Seed the initial agent into the database
pnpm exec tsx scripts/init-cli-agent.ts \
  --display-name "YourName" \
  --agent-name "Terminal Agent"

# 6. Start the service
systemctl --user daemon-reload
systemctl --user start nanoclaw-v2-ab12cd34
```

| Step | Why it can't be skipped |
|---|---|
| `pnpm install` | Compiles `better-sqlite3` native module. Without it `dist/index.js` crashes at startup. |
| `pnpm run build` | Produces `dist/` from `src/`. The systemd unit points at `dist/index.js` — no `tsx` at runtime. |
| `mkdir -p logs` | `StandardOutput = append:…/logs/nanoclaw.log` — systemd fails to start if the directory is missing. |
| `docker build` | Creates the image every agent session runs in. Tag **must** be `nanoclaw-agent-v2-<slug>:latest` — derived from project path in `src/config.ts`. |
| `init-cli-agent.ts` | Seeds `agent_groups` and related tables in `data/v2.db`. Without it, the router has no group to route messages to and drops everything silently. |

---

## OneCLI — Post-Install Config

After the gateway is running and the CLI binary is on PATH, run these once:

```bash
# 1. Point the CLI at the gateway
onecli config set api-host http://localhost:10254

# 2. Register your Anthropic credential
#    API key path:
onecli secrets create \
  --name Anthropic \
  --type anthropic \
  --value sk-ant-api... \
  --host-pattern api.anthropic.com

#    OAuth token path (from `claude setup-token`):
onecli secrets create \
  --name Anthropic \
  --type anthropic \
  --value sk-ant-oat...AA \
  --host-pattern api.anthropic.com
```

**Why this matters:** `src/container-runner.ts` calls `onecli.applyContainerConfig()` before every `docker run`. This injects `HTTPS_PROXY` + certificates so container API calls route through the gateway, which adds the `Authorization` header at the proxy level. The container never holds the API key directly. If no credential is registered, `applyContainerConfig()` throws and the container refuses to spawn — no messages will ever get a response.

---

## Dev Shell (for `pnpm install` / Native Modules)

`better-sqlite3` compiles a native `.node` addon via `node-gyp`. On NixOS the compiler toolchain is only available inside a build environment. Add to your flake:

```nix
devShells.default = pkgs.mkShell {
  buildInputs = with pkgs; [
    nodejs_22
    nodePackages.pnpm
    gcc
    gnumake
    python3
    pkg-config
    openssl
  ];
  shellHook = ''
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
    export npm_config_build_from_source=true
  '';
};
```

Then `nix develop` before running `pnpm install`.

---

## Quick Reference

| Piece | Where | Why |
|---|---|---|
| `virtualisation.docker.enable` | `flake.nix` system | Host process spawns containers at runtime |
| User in `docker` group | `flake.nix` system | Reach socket without sudo |
| `users.users.X.linger = true` | `flake.nix` system | Keep user services alive after logout |
| OneCLI gateway systemd service | `flake.nix` system | Credential proxy for all agent containers |
| OneCLI CLI derivation | `flake.nix` system packages | `onecli` must be on PATH |
| `nanoclaw-v2-<slug>` systemd unit | home-manager | Replaces what `setup/service.ts` generates |
| `~/.config/nanoclaw/mount-allowlist.json` | home-manager `home.file` | Container mount security policy |
| `~/.local/bin/ncl` symlink | home-manager `home.file` | CLI client shortcut |
| `ONECLI_URL` + secrets | sops/agenix → `EnvironmentFile` | Runtime config: where is the credential proxy |
| `onecli config set api-host` | Run once | Points the CLI at the gateway |
| `onecli secrets create` | Run once | Registers Anthropic credential in vault |
| `pnpm install` + `pnpm run build` | Run once in project dir | JS deps + compiled output |
| `docker build -t nanoclaw-agent-v2-<slug>:latest .` | Run once in `container/` | Agent image every session runs inside |
| `tsx scripts/init-cli-agent.ts` | Run once in project dir | Seeds initial agent in DB |

---

## Related

- [[Tailscale Setup Guide]]
- [[Pi Clean Reinstall Guide]]
- [NanoClaw GitHub](https://github.com/nanocoai/nanoclaw)
- [OneCLI](https://onecli.sh)
- [NixOS Wiki — Docker](https://wiki.nixos.org/wiki/Docker)
- [NixOS Wiki — Systemd user services](https://wiki.nixos.org/wiki/Systemd/User_services)
