---
tags:
  - tailscale
  - vpn
  - remote-access
  - nixos
  - selfhosted
type: reference
status: active
---
# Tailscale Setup Guide

**Purpose:** Securely connect NixOS desktop, NixOS laptop, and Android phone over an encrypted mesh VPN. No port forwarding, no public IP needed, no open firewall holes.

**Last updated:** 2026-06-02

---

## How Tailscale Works

Tailscale builds a **WireGuard-based mesh VPN** called a *tailnet*. Each device gets a `100.x.x.x` IP and connects peer-to-peer (encrypted). A coordination server helps devices find each other — it sees metadata (which IPs talk) but **cannot read traffic** (end-to-end encrypted).

```
[Desktop: 100.x.x.x] ←──encrypted──→ [Laptop: 100.x.x.x]
        ↕                               ↕
        └──encrypted──→ [Phone: 100.x.x.x]
```

### What Tailscale collects (free tier)

| Tailscale sees | Tailscale cannot see |
|---|---|
| Public IPs of your devices (for peering) | Your traffic content |
| Which nodes talk to which (metadata) | Your private keys (stay on devices) |
| Device names, OS, hostname | Your DNS queries |
| Public encryption keys | Decrypted data on DERP relays |
| Connection stats, data volume | Your browsing activity |

From their security page: *"Tailscale does not (and cannot) inspect your traffic. Privacy is a fundamental human right."*

### Business model (why free tier exists)

Free users → love it → bring it to work → company buys corporate plan (SSO, ACLs, audit). They monetize corporations, not your data. [Blog post: *"You are not the product"*](https://tailscale.com/blog/free-plan)

- SOC 2 Type II certified
- DERP relay servers open-source on GitHub — verifiable no-logging
- US-based, will comply with valid legal process (but can't decrypt your traffic)

---

## Step 1 — Tailscale Account

1. Go to https://login.tailscale.com
2. Sign in with Google / GitHub / Microsoft (pick one)
3. Free tier: up to 3 users, 100 devices. One user covers all 3 devices.

---

## Step 2 — Desktop (NixOS, home machine)

### 2a. Enable in configuration.nix

```nix
services.tailscale = {
  enable = true;
};
```

Rebuild:

```bash
sudo nixos-rebuild switch
```

### 2b. Start and authenticate

```bash
sudo systemctl start tailscaled
sudo tailscale up
```

A URL prints to terminal. Open in browser, log in. Done.

Verify:

```bash
tailscale status
# → 100.x.x.x  desktop  yourname@ linux   active; direct
```

### 2c. Enable SSH access

**Option A: OpenSSH (classic)**

```nix
services.openssh = {
  enable = true;
  settings = {
    PasswordAuthentication = false;     # key-only
    PermitRootLogin = "no";
  };
};

users.users.mathipe.openssh.authorizedKeys.keys = [
  "ssh-ed25519 AAAAC3..."   # your public key
];
```

```bash
sudo nixos-rebuild switch
```

**Option B: Tailscale SSH (simpler)**

```bash
sudo tailscale up --ssh
```

Tailscale SSH authenticates via your identity provider (SSO). No keys to copy. Tailscale manages SSH host keys per node.

---

## Step 3 — Laptop (ThinkPad X1 Carbon, NixOS)

Same steps:

### 3a. Enable

```nix
services.tailscale.enable = true;
```

```bash
sudo nixos-rebuild switch
```

### 3b. Authenticate

```bash
sudo tailscale up
# optionally: --ssh
```

### 3c. Verify

```bash
tailscale status
```

Both desktop and laptop should show up.

---

## Step 4 — Phone (Android)

### 4a. Install app

- **Google Play Store:** "Tailscale" (official)
- **F-Droid:** also available (no Google Play dependency)

### 4b. Log in

Open app → log in with same provider as desktop/laptop. Grant VPN permission when prompted.

### 4c. Verify

App shows device list with desktop and laptop. Each has `100.x.x.x` IP.

---

## Step 5 — Access from Phone

### 5a. SSH into desktop/laptop

**Using Termux (terminal emulator):**

Install from F-Droid (recommended, more up-to-date than Play Store):

```bash
pkg update
pkg install openssh
```

Then:

```bash
ssh mathipe@100.x.x.10   # desktop
ssh mathipe@100.x.x.11   # laptop
```

If using **Tailscale SSH** (`--ssh` flag), auth is automatic — no password, no key prompt.

**Using a dedicated SSH app:**

| App | Notes |
|---|---|
| **JuiceSSH** | Clean UI, works over Tailscale tunnel |
| **Termius** | Nice UX, saves host configs |
| **ConnectBot** | Lightweight, open-source |

In any SSH app: host = `100.x.x.10`, user = `mathipe`, auth = key or none (Tailscale SSH).

### 5b. Web services

If desktop runs a web service (dev server, dashboard, etc):

Phone browser → `http://100.x.x.10:3000` (or whatever port). Works because phone is inside tailnet.

### 5c. Taildrop — file sharing

Send files between devices without cloud intermediary:

```bash
# Desktop → phone:
tailscale file cp myphoto.jpg 100.x.x.5:

# Phone → desktop (in Termux):
tailscale file cp document.pdf 100.x.x.10:
```

On Android, received files appear in notification → "Save to Downloads".

---

## Step 6 — Tailscale Serve (expose services within tailnet)

If desktop runs a service (e.g., web app on port 3000):

```bash
tailscale serve --bg 3000
```

Now accessible from any tailnet device at:

```
http://desktop:3000
# or
http://100.x.x.10:3000
```

No port forwarding. Only reachable within your tailnet.

---

## Security Hardening

### Access Controls (ACLs)

Go to https://login.tailscale.com → ACLs. Default allows everything between your devices. Lock it down:

```json
{
  "acls": [
    // Laptop gets full access
    {"action": "accept", "src": ["laptop"], "dst": ["*:*"]},
    // Phone only SSH
    {"action": "accept", "src": ["phone"], "dst": ["*:22"]},
  ]
}
```

### Tailnet Lock (advanced)

Prevents rogue nodes from joining even if coordination server compromised:

```bash
sudo tailscale lock init
```

Requires quorum of trusted nodes to sign new devices. Adds operational complexity.

### Firewall on NixOS

`services.tailscale.enable = true` automatically opens the right ports. Tailscale traffic bypasses your NixOS firewall for tailnet-internal traffic. Services exposed on your LAN (non-Tailscale) are still protected by the firewall.

---

## Key Commands Reference

| Command | Purpose |
|---|---|
| `sudo tailscale up` | Connect to tailnet |
| `sudo tailscale up --ssh` | Connect + enable Tailscale SSH |
| `tailscale status` | Show connected devices |
| `tailscale ip` | Show this device's tailnet IP |
| `tailscale serve --bg <port>` | Expose local port to tailnet |
| `tailscale file cp <file> <target>:` | Send file via Taildrop |
| `tailscale file get` | Receive received files |
| `tailscale logout` | Disconnect from tailnet |
| `tailscale down` | Stop tailscale |

---

## Privacy Considerations

- Tailscale **cannot read your traffic** — end-to-end encrypted via WireGuard
- Coordination server sees metadata (which nodes talk, when, public IPs)
- No advertising, no data selling, no traffic inspection
- **Headscale** (self-hosted control server) removes even metadata exposure — runs on a $4/mo VPS, same client UX

### Tailscale vs Headscale

| Aspect | Tailscale Free | Headscale (self-hosted) |
|---|---|---|
| Coordination server | Tailscale (US) | Your VPS |
| Metadata visibility | Tailscale sees it | Only you see it |
| E2E encryption | Yes (WireGuard) | Yes (WireGuard) |
| Legal jurisdiction | US (subpoena power) | Your VPS jurisdiction |
| Setup effort | 15 minutes | 1-2 hours + VPS maintenance |

---

## Related

- [[PiDev/Web Search Extension]]
- [Tailscale Privacy Policy](https://tailscale.com/privacy-policy)
- [Tailscale Security](https://tailscale.com/security)
- [How NAT Traversal Works (Tailscale blog)](https://tailscale.com/blog/how-nat-traversal-works)
- [NixOS Wiki — Tailscale](https://wiki.nixos.org/wiki/Tailscale)
- [Headscale (self-hosted alternative)](https://github.com/juanfont/headscale)
