---
tags:
  - slack
  - bot
  - tailscale
  - socket-mode
  - python
  - nixos
type: reference
status: active
---
# Slack Bot with Ollama

**Overview:** How to run a Slack bot on your desktop using Slack Socket Mode. The bot connects outbound via WebSocket — **no tunnels, no public IP, no Tailscale needed.** Tailscale is optional; only required if you also want remote SSH or web access to your desktop.

**Last updated:** 2026-06-02

---

## The Problem

A Slack bot needs to **receive events** (messages, mentions, commands, button clicks). Traditional approach requires Slack to POST HTTP requests to a public URL your bot exposes. If your machine has no public IP or is behind NAT, this is tricky.

### Traditional options (not ideal)

| Method | Problem |
|---|---|
| Port forwarding | Exposes port to internet, requires public IP |
| Cloudflare Tunnel | Adds third-party dependency, makes machine publicly reachable |
| Tailscale Funnel | Beta feature, publicly exposes your service |
| VPS relay | Adds cost and complexity |

---

## Solution: Slack Socket Mode

Slack's **Socket Mode** is built for exactly this scenario. Instead of Slack pushing HTTP to you, your bot opens an **outbound WebSocket connection** to Slack. Slack sends events through that tunnel.

```
[Desktop]
    │
    ├── Outbound WebSocket ──→ api.slack.com
    │     (bot connects out, stays open)
    │
    └── Bot processes events, replies via same socket
```

**Result:**
- No inbound ports needed
- No public URL
- No Tailscale needed — works over plain internet
- Bot works outbound-only, just like any web browser

---

## Step-by-step Setup (Python Bolt)

### 1. Create Slack App

1. Go to https://api.slack.com/apps → **Create New App** → From scratch
2. Name it, pick workspace

### 2. Enable Socket Mode

App Settings → **Socket Mode** → Toggle on → Name your connection (e.g., "bot-websocket")

This generates an **App-Level Token** starting with `xapp-`. Save it.

### 3. Set Bot Token Scopes

App Settings → **OAuth & Permissions** → **Scopes** → Add OAuth Scopes:

| Scope | Purpose |
|---|---|
| `app_mentions:read` | See when bot is @-mentioned |
| `chat:write` | Send messages |
| `channels:history` | Read channel messages (if needed) |
| `reactions:write` | Add emoji reactions |
| `commands` | Handle slash commands |

Click **Install to Workspace** → Authorize. Save the **Bot Token** (`xoxb-...`).

### 4. Subscribe to Events

App Settings → **Event Subscriptions** → **Enable Events** → **Subscribe to bot events:**

| Event | Purpose |
|---|---|
| `app_mention` | Bot is @-mentioned |
| `message.channels` | Messages in public channels |
| `message.im` | Direct messages to bot |

### 5. Install dependencies

```bash
pip install slack_bolt
```

### 6. Write the bot (`bot.py`)

```python
import os
from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler

app = App(token=os.environ["SLACK_BOT_TOKEN"])

@app.message("hello")
def say_hello(message, say):
    say(f"Hi <@{message['user']}>!")

@app.event("app_mention")
def handle_mention(event, say):
    say(f"Thanks for mentioning me!")

@app.command("/status")
def status(ack, say):
    ack()  # acknowledge immediately
    import subprocess
    result = subprocess.run(
        ["uptime"], capture_output=True, text=True
    )
    say(f"Desktop status: `{result.stdout.strip()}`")

if __name__ == "__main__":
    handler = SocketModeHandler(
        app,
        os.environ["SLACK_APP_TOKEN"]
    )
    handler.start()
```

### 7. Run it

```bash
export SLACK_BOT_TOKEN="xoxb-your-bot-token"
export SLACK_APP_TOKEN="xapp-your-app-token"
python bot.py
```

Bot connects to Slack via outbound WebSocket. Messages in Slack trigger your handlers.

---

## Run as NixOS Service (auto-start on boot)

Add to `configuration.nix`:

```nix
systemd.services.slack-bot = {
  description = "Slack Bot";
  after = [ "network.target" ];  # Tailscale not required — remove if not using it
  wantedBy = [ "multi-user.target" ];
  environment = {
    SLACK_BOT_TOKEN = "xoxb-...";
    SLACK_APP_TOKEN = "xapp-...";
  };
  serviceConfig = {
    ExecStart = "${pkgs.python3}/bin/python /home/mathipe/slack-bot/bot.py";
    User = "mathipe";
    Restart = "always";
  };
};
```

**Note on token security:** Storing tokens in the Nix store (world-readable) isn't ideal. Better options:
- Use `sops-nix` for encrypted secrets
- Use `environmentFile` pointing to a restricted file
- Use `systemctl set-environment` at boot

---

## Bot Interacting with Desktop Services

Since the bot runs directly on your desktop, it can access anything on that machine:

```python
@app.message("gpu temp")
def gpu_temp(message, say):
    import subprocess
    result = subprocess.run(
        ["nvidia-smi", "--query-gpu=temperature.gpu", "--format=csv,noheader"],
        capture_output=True, text=True
    )
    say(f"GPU temperature: {result.stdout.strip()}°C")
```

Similarly for files, databases, running scripts — your desktop is the bot's local environment.

---

## LLM Bot with Thread Conversation Context (Ollama + GPU)

Running a bot that replies using a local LLM (Ollama + GPU) and preserves **full thread context** for follow-up questions.

### Architecture

```
Phone:  "@bot what is a fractal?"
                ↓
          Slack cloud → WebSocket → Desktop bot
                ↓
          Bot fetches thread history (conversations.replies)
                ↓
          Builds full message history → Ollama (localhost:11434)
                ↓
          GPU generates response
                ↓
          Bot replies in thread via thread_ts
                ↓
Phone sees reply
                ↓
User follows up: "give me a real example"
                ↓
          Bot fetches thread → sees both previous messages + new one
          Ollama gets full context → coherent follow-up reply
```

### Key mechanism: `thread_ts`

The Slack message event contains two timestamps:
- `event["ts"]` — this message's timestamp
- `event["thread_ts"]` — parent thread timestamp (set if already in a thread)

Pass either as `thread_ts` to `say()`:

```python
thread_ts = event.get("thread_ts") or event["ts"]
say("Reply", thread_ts=thread_ts)   # nests under original
```

### Full conversation-aware bot

```python
import os
import re
import threading
from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler
from ollama import chat

app = App(token=os.environ["SLACK_BOT_TOKEN"])
OLLAMA_MODEL = "llama3"   # or mistral, gemma, etc.

def get_thread_context(client, channel, thread_ts):
    """Fetch full thread history from Slack."""
    result = client.conversations_replies(
        channel=channel,
        ts=thread_ts
    )
    return result["messages"]   # oldest first

def build_ollama_messages(slack_messages, bot_user_id):
    """Convert Slack thread into Ollama message history."""
    history = [
        {"role": "system", "content": "You are a helpful assistant."}
    ]

    for msg in slack_messages:
        text = msg.get("text", "")
        is_bot = msg.get("user") == bot_user_id or msg.get("bot_id") is not None

        # Clean @-mentions from text
        clean = re.sub(r"<@\w+>", "", text).strip()
        if not clean:
            continue

        role = "assistant" if is_bot else "user"
        history.append({"role": role, "content": clean})

    return history

@app.event("app_mention")
def handle_mention(event, say, client):
    user = event["user"]
    channel = event["channel"]
    thread_ts = event.get("thread_ts") or event["ts"]

    # Immediate ack so user sees something
    say(f"<@{user}> :brain: Thinking...", thread_ts=thread_ts)

    def generate():
        try:
            # Get bot's own user ID
            bot_info = client.auth_test()
            bot_user_id = bot_info["user_id"]

            # Fetch full thread
            thread_msgs = get_thread_context(client, channel, thread_ts)

            # Build message history for Ollama
            ollama_messages = build_ollama_messages(thread_msgs, bot_user_id)

            # Generate reply
            response = chat(model=OLLAMA_MODEL, messages=ollama_messages)
            reply = response["message"]["content"]

            say(reply, thread_ts=thread_ts)

        except Exception as e:
            say(f":x: Error: {e}", thread_ts=thread_ts)

    threading.Thread(target=generate, daemon=True).start()

if __name__ == "__main__":
    handler = SocketModeHandler(app, os.environ["SLACK_APP_TOKEN"])
    handler.start()
```

### What it looks like in Slack

```
@bot what is a fractal?
    ↓
[bot]  🧠 Thinking...
    ├── [bot]  A fractal is a never-ending pattern...
    │
    │   User replies in thread: give me a real example
    │              ↓
    │   [bot] app_mention fires again
    │   Fetches thread → sees both messages
    │   Ollama gets: [user] what is a fractal?
    │                [assistant] A fractal is...
    │                [user] give me a real example
    │              ↓
    │   [bot]  Sure! A coastline is a natural fractal...
    │
    └── Each follow-up carries full conversation context
```

### Required Slack scopes

Add `channels:history` (and `groups:history` for private channels) to bot token scopes. This allows `conversations.replies` API to fetch thread content.

### Ollama setup on desktop

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model
ollama pull llama3

# Verify GPU is used
ollama run llama3 "hello"
```

Ollama auto-detects NVIDIA GPU (CUDA) or AMD (ROCm).

### Performance considerations

| Concern | Mitigation |
|---|---|
| LLM generation takes 5-30s | Background thread so bot stays responsive |
| Long threads = many tokens | Optionally cap to last N messages in bot code |
| API rate limits | Fine for personal bot, `conversations.replies` is cheap |

### How message history maps to Ollama

```
system: You are a helpful assistant.
user: what is a fractal?
assistant: A fractal is...
user: give me a real example
assistant: Sure! A coastline is a natural fractal...
```

- Bot's own messages → `assistant` role
- User messages → `user` role
- Empty text, @-mention noise → filtered out
- Full thread context every time → coherent multi-turn conversation

---

## Alternative Approaches

### Polling Slack API (no Socket Mode)

If you want to avoid Socket Mode entirely, poll the Slack Web API periodically:

```python
import time
import requests

token = os.environ["SLACK_BOT_TOKEN"]
while True:
    resp = requests.post("https://slack.com/api/conversations.history",
        headers={"Authorization": f"Bearer {token}"},
        json={"channel": "C123..."}
    )
    # process new messages
    time.sleep(10)
```

**Drawback:** No real-time events. You miss events outside polling interval.

### Tailscale Funnel (alternate approach)

If you prefer HTTP endpoints instead of WebSockets, expose a port via Tailscale Funnel:

```bash
tailscale funnel 8080
```

Then use Flask/FastAPI to receive Slack events:

```python
@app.route("/slack/events", methods=["POST"])
def slack_events():
    # verify signing secret, handle event
    return "", 200
```

Configure Slack to POST to `https://<machine>.ts.net/slack/events`.

**Trade-off:** Your service is publicly accessible (anyone with the URL), though still behind Tailscale's tunnel infrastructure. Socket Mode is more private.

---

## Summary

| Approach | Inbound ports? | Public URL? | Real-time? | Best for |
|---|---|---|---|---|
| **Socket Mode** | ❌ No | ❌ No | ✅ Yes | Most private, simplest setup |
| **Polling API** | ❌ No | ❌ No | ❌ No | Simple scripts, non-critical |
| **Tailscale Funnel** | ❌ No* | ✅ Yes | ✅ Yes | Need HTTP endpoints for some reason |
| **VPS relay** | ❌ No | ✅ VPS IP | ✅ Yes | Complex setups with multiple services |

**Socket Mode is the recommended approach.** Zero exposure, zero config beyond tokens. Tailscale is optional (only if you need remote SSH/web access to the desktop).

---

## Related

- [[Tailscale Setup Guide]]
- [Slack Socket Mode docs](https://api.slack.com/apis/connections/socket)
- [Bolt for Python](https://github.com/slackapi/bolt-python)
- [Socket Mode guide (Slack)](https://docs.slack.dev/apis/events-api/using-socket-mode)
