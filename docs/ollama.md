# Running Agents on Local Ollama

NanoClaw agents can be routed to a local [Ollama](https://ollama.com) instance instead of the Anthropic API. This cuts API costs to zero and keeps all inference on your hardware.

## How It Works

Ollama exposes an Anthropic-compatible `/v1/messages` endpoint. The Claude Code CLI (which runs inside agent containers) uses the Anthropic SDK, which reads `ANTHROPIC_BASE_URL` to find the API host. Pointing that variable at Ollama is almost all that's needed — the container-side agent runtime still needs an `ollama` entry in its provider registry (one line, aliasing the same `ClaudeProvider` class `claude` uses), since Ollama's protocol compatibility means zero _behavioral_ changes but the registry still keys off the provider name. See "What Was Changed at the Code Level" below.

```
┌─────────────────────────────┐
│  Agent container            │
│                             │
│  Claude Code CLI            │
│    ↓ ANTHROPIC_BASE_URL     │
│    http://host.docker.      │      ┌──────────────────┐
│    internal:11434    ───────┼─────▶│  Ollama :11434   │
│                             │      │  gemma4:latest   │
└─────────────────────────────┘      └──────────────────┘
```

`host.docker.internal` is Docker's magic hostname that resolves to the host machine from inside a container — so Ollama running on your Mac or Linux box is reachable at that address, **provided Ollama is actually listening on the interface that name resolves to**. See the Linux caveat below before assuming this works out of the box.

## Linux: Ollama Must Bind Beyond Loopback

On macOS, Docker Desktop runs containers inside a lightweight VM whose `host.docker.internal` transparently reaches services bound to `127.0.0.1` on the Mac. On Linux, Docker Engine is native — `host.docker.internal` resolves to the **docker0 bridge gateway IP** (typically `172.17.0.1`), a real, distinct network interface. `ollama serve`'s default bind is `127.0.0.1:11434` (loopback only), which is unreachable from that bridge IP. The container's requests will hang and the Claude Agent SDK will silently retry forever, logged as repeated `Error: API retry (retryable: true)` with no other indication of the cause.

Verify what Ollama is actually bound to:

```bash
ss -ltnp | grep 11434
# 127.0.0.1:11434  <- broken from inside a Linux container
# 0.0.0.0:11434    <- reachable
```

Fix by giving Ollama a wider bind via `OLLAMA_HOST`:

```bash
# Simplest — binds all interfaces, exposes Ollama to the whole LAN unless firewalled
OLLAMA_HOST=0.0.0.0:11434 ollama serve

# Tighter — binds only the docker bridge gateway, so only Docker containers on
# this host can reach it (check your actual bridge IP: `ip addr show docker0`)
OLLAMA_HOST=172.17.0.1:11434 ollama serve
```

For a durable setup, set `OLLAMA_HOST` in whatever manages `ollama serve` (a systemd user service, an environment file, etc.) rather than exporting it in an interactive shell.

This is a host/OS networking prerequisite, not a NanoClaw config issue — nothing in `container.json` or the DB needs to change for it.

## The OneCLI Complication

NanoClaw normally runs API calls through an OneCLI HTTPS proxy that injects real credentials in place of a placeholder key. When redirecting to Ollama you need to bypass that proxy so requests go direct. Two env vars handle this:

- `NO_PROXY=host.docker.internal` — tells the Anthropic SDK's HTTP client to skip the proxy for that hostname
- `no_proxy=host.docker.internal` — lowercase variant for tools that check the lowercase form

Both are injected by the host-side `ollama` provider (`src/providers/ollama.ts`) as `-e` Docker flags at container spawn time, alongside `ANTHROPIC_BASE_URL` — they are not written to `container.json` or any other file.

## Network Isolation

Setting `ANTHROPIC_BASE_URL` redirects requests but doesn't prevent a misconfigured agent from accidentally reaching `api.anthropic.com` directly. The `ollama` provider's `blockedHosts` (`src/providers/ollama.ts`) becomes a Docker `--add-host HOST:0.0.0.0` flag at spawn time, making the listed hosts physically unreachable from inside the container:

```ts
blockedHosts: ['api.anthropic.com', 'openrouter.ai'],
```

With this in place, even if the model setting drifts back to a Claude model name, the API call will fail immediately rather than silently billing your account. Verify with `docker inspect <container> --format '{{json .HostConfig.ExtraHosts}}'`.

## Model Selection

The model is a `container_configs.model` DB column, materialized into `groups/<folder>/container.json`'s `model` field, and read directly by the in-container agent-runner (`container/agent-runner/src/config.ts`) at startup — passed straight to the Claude Agent SDK. Set it with:

```bash
ncl groups config update --id <group-id> --provider ollama --model gemma4:latest
ncl groups restart --id <group-id>
```

(or `scripts/switch-provider.sh switch <folder> ollama gemma4:latest`, which resolves the group ID for you and does both steps). Use the exact model name from `ollama list`. This does **not** go through `~/.claude/settings.json` — that file exists but nothing writes a model into it automatically.

Model selection considerations for Apple Silicon:

| Model                | Size | Quality                    | Speed (M4 Pro) |
| -------------------- | ---- | -------------------------- | -------------- |
| `gemma4:latest`      | 12B  | Good general-purpose       | Fast           |
| `qwen3-coder:latest` | 32B  | Excellent for coding tasks | Moderate       |
| `llama3.2:latest`    | 3B   | Basic                      | Very fast      |

The agent uses tool calls extensively (read/write files, shell commands). Models that support tool use reliably work best. Gemma 4 and Qwen 3 Coder both handle structured tool calls well.

## Allowing Prompt Caching (filter the cache-busting hash)

Out of the box this path is slow — every reply re-reads the whole multi-thousand-token system prompt from scratch, even for a one-word answer. Ollama has a prompt cache that should skip that repeated work, but on this path it never kicks in.

**Cause.** The Claude Agent SDK adds a per-request hash to the front of every prompt — `x-anthropic-billing-header: ...; cch=<hash>;`. It changes on every request, and Ollama's cache only reuses a prompt whose start is unchanged. So that one shifting value at the front makes Ollama treat every prompt as new and re-read all of it. (Ollama ignores the hash itself, so filtering it has no effect on output.)

**Fix.** Run a tiny proxy between the container and Ollama that filters the hash out (pins `cch=<hash>` to a constant). The start of the prompt is now stable, so the cache kicks in and only the new message gets processed. In our setup — a 31B model on Apple Silicon — follow-up replies dropped from ~80s to ~4s; your numbers will vary with model size and hardware. Output is unchanged, since Ollama ignores the value anyway.

Point the agent group's `ANTHROPIC_BASE_URL` at the proxy instead of Ollama directly (everything else from the sections above is unchanged):

```
ANTHROPIC_BASE_URL=http://host.docker.internal:11999   # the proxy
# proxy forwards to http://127.0.0.1:11434 (Ollama)
```

The proxy is ~40 lines of dependency-free Node:

```js
// ollama-cch-proxy.mjs — normalize the SDK's per-request cch nonce so Ollama's
// prefix cache survives across turns. Listens on :11999, forwards to Ollama.
import http from 'node:http';

const TARGET_HOST = process.env.OLLAMA_HOST || '127.0.0.1';
const TARGET_PORT = Number(process.env.OLLAMA_PORT || 11434);
const LISTEN_PORT = Number(process.env.PROXY_PORT || 11999);

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let body = Buffer.concat(chunks);
    if (req.method === 'POST' && body.length) {
      body = Buffer.from(body.toString('utf8').replace(/cch=[0-9a-f]+;/g, 'cch=00000;'), 'utf8');
    }
    const headers = { ...req.headers, host: `${TARGET_HOST}:${TARGET_PORT}`, 'content-length': String(body.length) };
    const proxyReq = http.request(
      { host: TARGET_HOST, port: TARGET_PORT, method: req.method, path: req.url, headers },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on('error', (e) => {
      res.writeHead(502);
      res.end(String(e));
    });
    proxyReq.end(body);
  });
});
server.listen(LISTEN_PORT, '0.0.0.0', () => console.log(`cch-proxy :${LISTEN_PORT} -> ${TARGET_HOST}:${TARGET_PORT}`));
```

Run it durably so it survives reboots. On Linux, a systemd user service:

```ini
# ~/.config/systemd/user/ollama-cch-proxy.service
[Unit]
Description=Ollama cch-normalizing proxy for NanoClaw
After=network-online.target

[Service]
ExecStart=/usr/bin/node %h/.config/nanoclaw/ollama-cch-proxy.mjs
Restart=always

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now ollama-cch-proxy
loginctl enable-linger "$USER"   # so it runs without an active login session
```

On macOS use a `launchd` user agent (`~/Library/LaunchAgents/`) running the same script.

**Scope.** This only affects the Claude-Code-CLI → Ollama path described here. Codex and OpenCode don't use the Claude Agent SDK, so they never emit the `cch` hash and get prompt caching for free.

## What Was Changed at the Code Level

The Ollama provider is implemented. Changes made:

**`src/providers/provider-container-registry.ts`** — added `blockedHosts?: string[]` and `bypassOnecli?: boolean` to `ProviderContainerContribution`.

**`src/providers/ollama.ts`** — new file; registers the `ollama` provider with `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `NO_PROXY`/`no_proxy`, `blockedHosts`, and `bypassOnecli: true`.

**`src/providers/index.ts`** — added `import './ollama.js'`.

**`src/container-runner.ts`** — `buildContainerArgs` now applies `providerContribution.blockedHosts` as `--add-host HOST:0.0.0.0` flags, and gates the OneCLI block behind `!providerContribution.bypassOnecli`.

**`container/agent-runner/src/providers/claude.ts`** — added a container-side `registerProvider('ollama', (opts) => new ClaudeProvider(opts))`. This was missing from the original WIP commit above, which only wired the host side; the container-side agent-runner had no `ollama` entry in its own provider registry (which is separate from the host-side one) and failed at spawn with `Unknown provider: ollama. Registered: claude, mock, opencode`. Since Ollama speaks the Anthropic protocol, no new runtime class was needed — just a registry entry pointing at the existing `ClaudeProvider`.

## Tradeoffs

|                      | Ollama (local)      | Anthropic API          |
| -------------------- | ------------------- | ---------------------- |
| Cost                 | Free                | Pay-per-token          |
| Privacy              | Fully local         | Data sent to Anthropic |
| Model quality        | Good (open-weight)  | Excellent (Claude)     |
| Cold start           | 5–30s (model load)  | ~1s                    |
| Context window       | Varies by model     | 200k tokens (Sonnet)   |
| Tool use reliability | Good (large models) | Excellent              |
| Hardware req.        | 16GB+ RAM           | None                   |

For personal automation on capable hardware, the tradeoff favors local. For complex multi-step tasks requiring large context or high reliability, Claude is still ahead.

## Reverting to Claude

```bash
ncl groups config update --id <group-id> --provider claude
ncl groups restart --id <group-id>
```

(or `scripts/switch-provider.sh switch <folder> claude [model]`). No rebuild needed — provider/model live in the DB and are re-materialized into `container.json` at spawn time; the container-side agent-runner source is bind-mounted read-only, so code fixes to it also take effect on a plain restart.

## See Also

- `/add-ollama-provider` — step-by-step skill to configure an agent group for Ollama the first time
- `/switch-provider` — toggle an already-configured group between `ollama`/`opencode`/`claude` (and models) via `scripts/switch-provider.sh`
- [Ollama Anthropic compatibility docs](https://ollama.com/blog/openai-compatibility) — upstream docs on the API bridge
- `docs/architecture.md` — how the container spawn and env injection pipeline works
