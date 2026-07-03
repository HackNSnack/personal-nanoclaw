---
tags: [nanoclaw, onecli, docker, dns, vpn, debugging]
type: reference
status: active
---

# OneCLI Gateway DNS Failure — Stale Resolver After Host VPN Disconnect

**Symptom:** Claudette replies with:
```
Error: OpenCode retry limit (3): Bad Gateway: OneCLI gateway failed to resolve rules for this request.
```
User had asked the bot to fetch `meny.no/sok?query=hamburger` directly; after a couple of working replies, a follow-up ("try again now, check if it's my VPN") failed with this error.

---

## Investigation

Host-side logs (`logs/nanoclaw.log`, `logs/nanoclaw.error.log`) showed nothing — no spawn errors, no container-exit lines for the session. The session's container (`nanoclaw-v2-cli-with-mathipe-*`) was still running (`docker ps`), so `docker logs <container>` gave the actual error:

```
[poll-loop] Query error: OpenCode retry limit (3): Bad Gateway: OneCLI gateway failed to resolve rules for this request.
```

That error string comes from the **`onecli` gateway container itself**, not the agent-runner. `docker logs onecli` showed the real cause:

```
WARN request forwarding failed host=openrouter.ai:443
  error=forwarding to https://openrouter.ai:443/api/v1/chat/completions
    0: error sending request for url (...)
    1: client error (Connect)
    2: dns error
```

Repeated on every retry (3x, ~10-30s apart) — the gateway's MITM proxy could not resolve `openrouter.ai` from inside its own Docker network.

### Root Cause — Stale `resolv.conf` From a Since-Dropped Host VPN

1. **ProtonVPN app** was running on the host (`ps aux` → `proton-vpn-app`, started earlier that morning).
2. The `onecli` gateway container started later while the VPN tunnel was up. Docker generated the container's `/etc/resolv.conf` at that moment, caching the VPN's DNS servers:
   ```
   nameserver 127.0.0.11
   # ExtServers: [host(10.2.0.1) host(2a07:b944::2:1)]
   ```
   `2a07:b944::/32` is a Proton VPN DNS resolver range — confirms the VPN tunnel was active at container-start time.
3. At some point the VPN tunnel dropped (checked `ip addr` / `ip route` — no `tun`/`wg` interface, default route goes straight out `wlp0s20f3` to the router).
4. Docker's embedded DNS (`127.0.0.11` inside the container) does **not** live-refresh its upstream server list — it keeps using the cached VPN DNS server (`2a07:b944::2:1`), which is now unreachable since the tunnel is gone.
5. Result: DNS lookups for external hosts (`openrouter.ai`) intermittently/permanently fail inside the `onecli` container, while the host itself resolves fine via its normal router DNS (`192.168.1.1`).

The user's own hypothesis ("is it my VPN in the way?") was correct in spirit — but it was the **host machine's own VPN client** (ProtonVPN), not anything on the user's side, and the mechanism was a stale cached DNS resolver, not an active routing conflict.

### Confirming Commands

```bash
# Gateway container's cached DNS config
docker exec onecli cat /etc/resolv.conf

# Gateway container logs — the actual forwarding/DNS error
docker logs --since 20m onecli | grep -i "dns error\|forwarding failed"

# Is a VPN client running on the host?
ps aux | grep -iE "vpn|wireguard|mullvad|tailscale" | grep -v grep

# Is a VPN tunnel currently active? (no tun/wg interface = not connected)
ip addr show; ip route

# Host DNS still works fine (for comparison)
getent ahostsv4 openrouter.ai
```

---

## Fix

**Immediate:** restart the `onecli` container so Docker regenerates `/etc/resolv.conf` against the host's *current* (working) DNS config:
```bash
docker restart onecli
```

**Durable fix (not yet applied):** pin a stable public DNS resolver for the `onecli` compose service so it's immune to the host's VPN connect/disconnect cycles, e.g. in `~/.onecli/docker-compose.yml` (or an override file):
```yaml
services:
  onecli:
    dns:
      - 1.1.1.1
      - 8.8.8.8
```
Then `docker compose up -d` to apply.

---

## Where the OneCLI Gateway Lives

- Compose project: `~/.onecli/docker-compose.yml` (+ `docker-compose.override.yml` symlinked from nix store)
- Containers: `onecli` (gateway, ports `10254` web UI / `10255` API proxy) + `onecli-postgres-1`
- Network: `onecli_onecli` bridge, `172.19.0.0/16`, IPv6 disabled
- The web UI on `10254` returning HTTP 200 does **not** mean the gateway's outbound proxying works — it only confirms the Next.js frontend is up. Check `docker logs onecli` for actual request-forwarding health.

---

## Diagnostic Path (for next time)

1. Session DBs show `messages_out` has a reply, but it's an error string → agent-runner-level failure, not a delivery failure.
2. No host-log (`nanoclaw.log`/`.error.log`) entries for the session at that timestamp → the failure is *inside* the container, not in host orchestration.
3. Container still running (not `--rm`-reaped yet) → `docker logs <container-name>` gets the agent-runner's own stderr, which named the real error: `Bad Gateway: OneCLI gateway failed to resolve rules`.
4. "OneCLI gateway failed to resolve rules" → check the gateway itself, not the agent container: `docker logs onecli`.
5. Gateway logs pointed at a `dns error` on outbound MITM forwarding → check host VPN state and the gateway container's cached `/etc/resolv.conf`.

---

## Related

- [[Clients/Personal/AgentNotes/Reference/NanoClaw/OpenRouter 504 Upstream Idle Timeout — Retry Logic]] — a different cause of the same "OpenCode retry limit (3)" error prefix; that one is an OpenRouter-side stall, this one is a local DNS/proxy failure inside the OneCLI gateway container.
- [[Clients/Personal/AgentNotes/Reference/NanoClaw/NanoClaw Operations]]
