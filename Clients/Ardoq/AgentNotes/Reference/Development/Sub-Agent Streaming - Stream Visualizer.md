---
tags: [sub-agent, streaming, debugging, cli, smoke-test, reference]
type: reference
---

# Sub-Agent Streaming — Stream Visualizer & Smoke Test

Two runtime/integration tools for observing and validating the streaming agent stack end-to-end.

## Original locations

| File | Path |
|------|------|
| `visualize_nested_stream.py` | `projects/ai_agents/scripts/visualize_nested_stream.py` |
| `test_smoke_streaming.py` | `projects/ai_agents/tests/test_smoke_streaming.py` |

## Restore instructions

**Visualizer:** Drop `visualize_nested_stream.py` into `projects/ai_agents/scripts/`. Requires `httpx` and `python-dotenv`. Reads `ARDOQ_API_TOKEN` and `ARDOQ_ORG` from `.env` by default.

**Smoke test:** Drop `test_smoke_streaming.py` into `projects/ai_agents/tests/`. Requires the full FastAPI app (`src.api.app`) to be importable — run from the `projects/ai_agents` directory.

## Related

- [[Clients/Ardoq/AgentNotes/Reference/Development/Sub-Agent Streaming - Demo Agent]]
- [[Clients/Ardoq/AgentNotes/Reference/Development/Sub-Agent Streaming - Test Suite]]
- [[Clients/Ardoq/AgentNotes/Active/2026-04-27 Streaming nested sub-agent events to end user]]

---

## visualize_nested_stream.py

CLI that hits `/agent/stream`, reads NDJSON line-by-line, and pretty-prints every event type with ANSI colours. Recursively renders the `sub_agents` tree so you can see the parent ↔ child structure at a glance.

```
# Usage
python scripts/visualize_nested_stream.py
python scripts/visualize_nested_stream.py --prompt "Analyse: To be or not to be"
python scripts/visualize_nested_stream.py --host localhost --port 9000
python scripts/visualize_nested_stream.py --no-colour
```

```python
#!/usr/bin/env python3
"""Streaming visualiser for the nested_demo agent.

Connects to the /agent/stream endpoint, reads each NDJSON line as it arrives,
and renders every event type with distinct colours and indentation so you can
see the parent ↔ sub-agent structure at a glance.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import textwrap
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
FG_CYAN = "\033[36m"
FG_GREEN = "\033[32m"
FG_YELLOW = "\033[33m"
FG_RED = "\033[31m"
FG_MAGENTA = "\033[35m"
FG_BLUE = "\033[34m"
FG_WHITE = "\033[37m"
FG_BRIGHT_CYAN = "\033[96m"
FG_BRIGHT_GREEN = "\033[92m"
FG_BRIGHT_YELLOW = "\033[93m"
FG_BRIGHT_RED = "\033[91m"
FG_BRIGHT_WHITE = "\033[97m"

_USE_COLOUR = True


def _c(*codes: str) -> str:
    return "".join(codes) if _USE_COLOUR else ""


def _reset() -> str:
    return RESET if _USE_COLOUR else ""


_INDENT = "  "


def _wrap(text: str, width: int = 100, indent: str = "") -> str:
    return textwrap.fill(text, width=width, subsequent_indent=indent)


def _print_header(title: str, colour: str) -> None:
    bar = "─" * 60
    print(f"\n{_c(colour, BOLD)}{bar}")
    print(f"  {title}")
    print(f"{bar}{_reset()}")


def _print_kv(key: str, value: Any, indent: int = 0, key_colour: str = FG_CYAN) -> None:
    prefix = _INDENT * indent
    key_str = f"{_c(key_colour, BOLD)}{key}{_reset()}"
    val_str = str(value)
    line = f"{prefix}{key_str}: {val_str}"
    if len(line) > 120:
        wrapped = _wrap(val_str, width=100, indent=prefix + "  " + " " * (len(key) + 2))
        print(f"{prefix}{key_str}:\n{prefix}  {wrapped}")
    else:
        print(line)


def _print_json_block(data: dict[str, Any], indent: int = 1) -> None:
    prefix = _INDENT * indent
    dumped = json.dumps(data, indent=2, default=str)
    for line in dumped.splitlines():
        print(f"{_c(DIM)}{prefix}{line}{_reset()}")


def render_tool_call(event: dict[str, Any]) -> None:
    _print_header(f"🔧  TOOL CALL  →  {event.get('name', '?')}", FG_YELLOW)
    _print_kv("tool_call_id", event.get("tool_call_id"), indent=1, key_colour=FG_YELLOW)
    _print_kv("description", event.get("user_friendly_description", ""), indent=1, key_colour=FG_YELLOW)
    inp = event.get("input")
    if inp:
        print(f"{_INDENT}{_c(FG_YELLOW, BOLD)}input:{_reset()}")
        if isinstance(inp, dict):
            _print_json_block(inp, indent=2)
        else:
            print(f"{_INDENT * 2}{_c(DIM)}{inp}{_reset()}")


def render_tool_result(event: dict[str, Any]) -> None:
    _print_header(f"✅  TOOL RESULT  ←  {event.get('name', '?')}", FG_GREEN)
    _print_kv("tool_call_id", event.get("tool_call_id"), indent=1, key_colour=FG_GREEN)
    output = event.get("output", "")
    print(f"{_INDENT}{_c(FG_GREEN, BOLD)}output:{_reset()}")
    try:
        parsed = json.loads(output)
        _print_json_block(parsed if isinstance(parsed, dict) else {"value": parsed}, indent=2)
    except (json.JSONDecodeError, TypeError):
        for line in str(output).splitlines():
            print(f"{_INDENT * 2}{_c(DIM)}{line}{_reset()}")


def render_tool_error(event: dict[str, Any]) -> None:
    _print_header(f"❌  TOOL ERROR  ←  {event.get('name', '?')}", FG_RED)
    _print_kv("tool_call_id", event.get("tool_call_id"), indent=1, key_colour=FG_RED)
    _print_kv("message", event.get("message", ""), indent=1, key_colour=FG_RED)


def render_message(event: dict[str, Any], is_incremental: bool) -> None:
    content = event.get("content", "")
    if is_incremental:
        sys.stdout.write(f"\r{_c(DIM, FG_WHITE)}{content[:120]}{_reset()}   ")
        sys.stdout.flush()
    else:
        sys.stdout.write("\n")
        _print_header("💬  ASSISTANT MESSAGE  (final)", FG_BRIGHT_WHITE)
        try:
            parsed = json.loads(content)
            _print_json_block(parsed if isinstance(parsed, dict) else {"value": parsed}, indent=1)
        except (json.JSONDecodeError, TypeError):
            for line in content.splitlines():
                print(f"{_INDENT}{_c(FG_WHITE)}{line}{_reset()}")


def render_sub_agents(sub_agents: dict[str, Any], depth: int = 0) -> None:
    """Recursively render the sub_agents tree."""
    prefix = _INDENT * depth
    for agent_name, results in sub_agents.items():
        for idx, result in enumerate(results):
            status = result.get("status", "?")
            span_id = result.get("span_id", "?")[:8]
            parent_span = (result.get("parent_span_id") or "root")[:8]
            colour = FG_BRIGHT_GREEN if status == "success" else FG_BRIGHT_RED
            label = f"{'✓' if status == 'success' else '✗'}  SUB-AGENT: {agent_name} [{idx}]"
            print(f"\n{prefix}{_c(colour, BOLD)}{label}{_reset()}")
            print(f"{prefix}{_c(DIM)}span: {span_id}  parent: {parent_span}{_reset()}")
            if status == "success":
                output = result.get("output", "")
                print(f"{prefix}{_c(FG_BRIGHT_GREEN, BOLD)}output:{_reset()}")
                try:
                    parsed = json.loads(output)
                    _print_json_block(parsed if isinstance(parsed, dict) else {"value": parsed}, indent=depth + 2)
                except (json.JSONDecodeError, TypeError):
                    for line in str(output).splitlines():
                        print(f"{prefix}{_INDENT * 2}{_c(DIM)}{line}{_reset()}")
            else:
                error = result.get("error", {})
                print(f"{prefix}{_c(FG_BRIGHT_RED, BOLD)}error:{_reset()} {error.get('message', '?')}")
            nested = result.get("sub_agents", {})
            if nested:
                print(f"{prefix}{_c(FG_MAGENTA, BOLD)}  └─ nested sub_agents:{_reset()}")
                render_sub_agents(nested, depth=depth + 2)


def render_completion_success(event: dict[str, Any]) -> None:
    sys.stdout.write("\n")
    _print_header(f"🏁  COMPLETION SUCCESS  —  {event.get('agent_name', '?')}", FG_BRIGHT_CYAN)
    span = (event.get("span_id") or "")[:8]
    parent = (event.get("parent_span_id") or "root")[:8]
    print(f"{_INDENT}{_c(DIM)}span: {span}  parent: {parent}{_reset()}")
    output = event.get("output", "")
    print(f"\n{_INDENT}{_c(FG_BRIGHT_CYAN, BOLD)}final output:{_reset()}")
    try:
        parsed = json.loads(output)
        _print_json_block(parsed if isinstance(parsed, dict) else {"value": parsed}, indent=2)
    except (json.JSONDecodeError, TypeError):
        for line in str(output).splitlines():
            print(f"{_INDENT * 2}{line}")
    sub_agents = event.get("sub_agents", {})
    if sub_agents:
        print(f"\n{_INDENT}{_c(FG_MAGENTA, BOLD)}sub_agents:{_reset()}")
        render_sub_agents(sub_agents, depth=2)
    else:
        print(f"\n{_INDENT}{_c(DIM)}(no sub_agents captured){_reset()}")


def render_completion_failure(event: dict[str, Any]) -> None:
    sys.stdout.write("\n")
    _print_header(f"💥  COMPLETION FAILURE  —  {event.get('agent_name', '?')}", FG_BRIGHT_RED)
    error = event.get("error", {})
    _print_kv("type", error.get("type", "?"), indent=1, key_colour=FG_BRIGHT_RED)
    _print_kv("message", error.get("message", "?"), indent=1, key_colour=FG_BRIGHT_RED)
    sub_agents = event.get("sub_agents", {})
    if sub_agents:
        print(f"\n{_INDENT}{_c(FG_MAGENTA, BOLD)}sub_agents (captured before failure):{_reset()}")
        render_sub_agents(sub_agents, depth=2)


def render_api_error(event: dict[str, Any]) -> None:
    sys.stdout.write("\n")
    _print_header("🚨  API ERROR", FG_BRIGHT_RED)
    _print_kv("error_type", event.get("error_type", "?"), indent=1, key_colour=FG_BRIGHT_RED)
    _print_kv("error", event.get("error", "?"), indent=1, key_colour=FG_BRIGHT_RED)


_INCREMENTAL_TYPES = {"message"}
_last_event_was_incremental = False


def dispatch(raw_line: str) -> None:
    """Parse one NDJSON line and dispatch to the appropriate renderer."""
    global _last_event_was_incremental  # noqa: PLW0603
    line = raw_line.strip()
    if not line:
        return
    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        print(f"{_c(FG_RED)}[unparseable line]{_reset()} {line}")
        return

    etype = event.get("type") or event.get("status")
    transitioning_out = _last_event_was_incremental and etype not in _INCREMENTAL_TYPES

    match etype:
        case "tool_call":
            if transitioning_out:
                sys.stdout.write("\n")
            render_tool_call(event)
            _last_event_was_incremental = False
        case "tool_result":
            if transitioning_out:
                sys.stdout.write("\n")
            render_tool_result(event)
            _last_event_was_incremental = False
        case "tool_error":
            if transitioning_out:
                sys.stdout.write("\n")
            render_tool_error(event)
            _last_event_was_incremental = False
        case "message":
            render_message(event, is_incremental=True)
            _last_event_was_incremental = True
        case "success":
            render_completion_success(event)
            _last_event_was_incremental = False
        case "failure":
            render_completion_failure(event)
            _last_event_was_incremental = False
        case "internal_error" | "context_window_exceeded" | "usage_limit_exceeded":
            if transitioning_out:
                sys.stdout.write("\n")
            render_api_error(event)
            _last_event_was_incremental = False
        case _:
            if transitioning_out:
                sys.stdout.write("\n")
            print(f"{_c(DIM)}[unknown event type={etype!r}]{_reset()}")
            _print_json_block(event, indent=1)
            _last_event_was_incremental = False


def stream(host: str, port: int, prompt: str, token: str | None, org: str | None) -> None:
    url = f"http://{host}:{port}/agent/stream"
    payload = {
        "newMessage": {"type": "message", "role": "user", "content": prompt},
        "messageHistory": {"elements": []},
        "agentType": "nested_demo",
    }
    resolved_token = token or os.getenv("ARDOQ_API_TOKEN", "")
    resolved_org = org or os.getenv("ARDOQ_ORG", "")
    if not resolved_token:
        print(f"{_c(FG_BRIGHT_RED)}Error: no API token.  Set ARDOQ_API_TOKEN or pass --token.{_reset()}")
        sys.exit(1)
    if not resolved_org:
        print(f"{_c(FG_BRIGHT_RED)}Error: no org label.  Set ARDOQ_ORG or pass --org.{_reset()}")
        sys.exit(1)
    headers: dict[str, str] = {
        "Content-Type": "application/json",
        "Accept": "application/x-ndjson",
        "Authorization": f"Bearer {resolved_token}",
        "x-org": resolved_org,
    }
    print(f"\n{_c(FG_BRIGHT_WHITE, BOLD)}Streaming from {url}{_reset()}")
    print(f"{_c(DIM)}org: {resolved_org}  prompt: {prompt[:80]}{_reset()}\n")
    with httpx.Client(timeout=None) as client:
        with client.stream("POST", url, json=payload, headers=headers) as response:
            if response.status_code != 200:
                print(
                    f"{_c(FG_BRIGHT_RED)}HTTP {response.status_code}{_reset()} — "
                    f"{response.read().decode('utf-8', errors='replace')}"
                )
                sys.exit(1)
            for line in response.iter_lines():
                dispatch(line)
    print(f"\n{_c(DIM)}─── stream finished ───{_reset()}\n")


DEFAULT_PROMPT = (
    "Please analyse the following passage for me: "
    "The quick brown fox jumps over the lazy dog near the riverbank. "
    "It was a warm summer afternoon and the forest was buzzing with life."
)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Visualise streamed NDJSON output from the nested_demo agent.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--host", default="localhost")
    p.add_argument("--port", default=8432, type=int)
    p.add_argument("--prompt", default=DEFAULT_PROMPT)
    p.add_argument("--token", default=None)
    p.add_argument("--org", default=None)
    p.add_argument("--no-colour", action="store_true")
    return p.parse_args()


def main() -> None:
    global _USE_COLOUR  # noqa: PLW0603
    args = parse_args()
    if args.no_colour:
        _USE_COLOUR = False
    stream(host=args.host, port=args.port, prompt=args.prompt, token=args.token, org=args.org)


if __name__ == "__main__":
    main()
```

---

## test_smoke_streaming.py

End-to-end smoke tests — starts the full FastAPI app with `pydantic-ai`'s `TestModel` (no real LLM calls), validates both the streaming and non-streaming endpoints return correct shapes.

```python
"""End-to-end smoke tests for agent request handling.

Validates that the service can start and successfully handle both streaming
and non-streaming requests. Uses pydantic-ai's TestModel to mock LLM responses
while testing the full request path.

These tests run in CI on every PR to catch startup/response regressions before production.
"""

import json
import os
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from pydantic_ai.models.test import TestModel

from src.api.app import app

STARTUP_ENV = {
    "LITE_LLM_ENDPOINT": "http://fake-llm-endpoint",
    "LITE_LLM_API_KEY": "fake-key",
    "ARDOQ_API_BASE_URL": "https://app.ardoq.com",
}

TEST_HEADERS = {
    "Authorization": "Bearer test-api-key",
    "x-ardoq-trace-id": "test-trace-id",
    "x-ardoq-user-id": "test-user-id",
    "x-org": "test-org",
    "host": "app.ardoq.com",
}

REQUEST_BODY = {
    "newMessage": {
        "type": "message",
        "role": "user",
        "content": "Hello",
    },
    "messageHistory": {"elements": []},
}


@pytest.fixture()
def smoke_client():
    """TestClient with TestModel and guardrails mocked out.

    Starts the full FastAPI app (including lifespan) with:
    - LLM replaced by pydantic-ai's TestModel (no network calls)
    - Guardrails bypassed (would otherwise call the fake LiteLLM endpoint)
    """

    def mock_get_model(*_args, **_kwargs) -> TestModel:
        return TestModel()

    with (
        patch.dict(os.environ, STARTUP_ENV),
        patch("src.api.config.lifespan.get_model", mock_get_model),
        patch("ardoq_ai.api.middleware.guardrails.apply_guardrails", AsyncMock()),
    ):
        with TestClient(app) as client:
            yield client


class TestAgentSmoke:
    def test_streaming_request_returns_200_with_message_events(self, smoke_client: TestClient):
        response = smoke_client.post("/api/agent/stream", json=REQUEST_BODY, headers=TEST_HEADERS)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        assert response.headers.get("content-type") == "application/x-ndjson"
        lines = [line for line in response.text.strip().split("\n") if line]
        assert len(lines) > 0
        events = [json.loads(line) for line in lines]
        message_events = [e for e in events if e.get("type") == "message" and e.get("role") == "assistant"]
        assert len(message_events) > 0, f"Expected at least one assistant message, got events: {events}"
        assert message_events[-1].get("content"), f"Final message should have content: {message_events[-1]}"

    def test_non_streaming_request_returns_200_with_output(self, smoke_client: TestClient):
        response = smoke_client.post("/api/agent", json=REQUEST_BODY, headers=TEST_HEADERS)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        body = response.json()
        assert body.get("status") == "success", f"Expected success status, got: {body}"
        assert body.get("final_output"), f"Expected non-empty final_output, got: {body}"
```
