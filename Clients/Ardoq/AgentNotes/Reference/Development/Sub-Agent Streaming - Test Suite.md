---
tags: [sub-agent, streaming, nested, testing, pytest, reference]
type: reference
---

# Sub-Agent Streaming — Test Suite

Unit tests for the sub-agent ContextVar machinery and the streaming completion path. Four files form a cohesive harness — restore them together.

## Original locations

| File | Path |
|------|------|
| `conftest.py` | `libs/ardoq_ai/tests/conftest.py` |
| `test_sub_agent.py` | `libs/ardoq_ai/tests/test_sub_agent.py` |
| `test_sub_agent_nesting.py` | `libs/ardoq_ai/tests/test_sub_agent_nesting.py` |
| `test_streaming_sub_agent.py` | `libs/ardoq_ai/tests/test_streaming_sub_agent.py` |

> **Note:** `conftest.py` was only depended on by these three test files — safe to recreate without affecting other tests.

## What each file covers

- **conftest.py** — shared fixtures: `DummyOutput`, `DummyDeps`, `make_mock_agent`, `make_side_effect_agent`, `run_test_completion`
- **test_sub_agent.py** — `AgentContext` ContextVar setup/teardown, span chain correctness, accumulator wiring, `run_completion` parent reporting
- **test_sub_agent_nesting.py** — 3-layer nesting (grandparent → parent → child), multi-child at mid-layer, mid-layer failure with child results preserved
- **test_streaming_sub_agent.py** — streaming path: context tracking, sub-agent accumulation through streams, span uniqueness, exception propagation

## Related

- [[Clients/Ardoq/AgentNotes/Reference/Development/Sub-Agent Streaming - Demo Agent]]
- [[Clients/Ardoq/AgentNotes/Reference/Development/Sub-Agent Streaming - Stream Visualizer]]
- [[Clients/Ardoq/AgentNotes/Active/2026-04-27 Streaming nested sub-agent events to end user]]

---

## conftest.py

```python
from collections.abc import Callable
from typing import Any
from unittest.mock import AsyncMock, MagicMock

from pydantic import BaseModel

from ardoq_ai.completion.non_streaming import run_completion
from ardoq_ai.completion.schemas.message import Message
from ardoq_ai.completion.schemas.result import CompletionFailure, CompletionSuccess


class DummyOutput(BaseModel):
    value: str


class DummyDeps(BaseModel):
    pass


def make_msg(content: str = "test") -> Message:
    return Message(role="user", content=content)


def make_mock_result(value: str) -> MagicMock:
    """Create a mock agent run result with the given output value."""
    mock = MagicMock()
    mock.output = DummyOutput(value=value)
    mock.new_messages.return_value = []
    mock.usage.return_value = MagicMock(
        input_tokens=1,
        output_tokens=1,
        total_tokens=2,
    )
    return mock


def make_mock_agent(name: str | None, value: str) -> MagicMock:
    """Create a mock agent that returns a fixed result."""
    agent = MagicMock()
    agent.name = name
    agent.run = AsyncMock(return_value=make_mock_result(value))
    return agent


def make_side_effect_agent(
    name: str,
    side_effect: Callable[..., Any] | BaseException,
) -> MagicMock:
    """Create a mock agent with a custom run side effect."""
    agent = MagicMock()
    agent.name = name
    agent.run = AsyncMock(side_effect=side_effect)
    return agent


async def run_test_completion(
    prompt: str,
    agent: MagicMock,
) -> CompletionSuccess[DummyOutput] | CompletionFailure:
    """Run completion with standard test boilerplate."""
    return await run_completion(
        new_message=make_msg(prompt),
        agent=agent,
        model=MagicMock(),
        logger=MagicMock(),
        dependencies=DummyDeps(),
    )
```

---

## test_sub_agent.py

```python
from contextvars import Token
from unittest.mock import MagicMock

import pytest
from conftest import (
    DummyOutput,
    make_mock_agent,
    make_mock_result,
    make_side_effect_agent,
    run_test_completion,
)

from ardoq_ai.completion.schemas.result import CompletionFailure, CompletionSuccess
from ardoq_ai.completion.span_context import (
    AgentAccumulator,
    AgentContext,
    get_agent_context,
    reset_agent_context,
    start_new_agent_context,
)


class TestAgentContext:
    def test_get_agent_context_returns_none_by_default(self) -> None:
        assert get_agent_context() is None

    def test_start_new_agent_context_with_no_parent(self) -> None:
        ctx, token = start_new_agent_context("test_agent", {})
        try:
            assert ctx.agent_name == "test_agent"
            assert ctx.span_id is not None
            assert ctx.parent_span_id is None
            assert get_agent_context() == ctx
        finally:
            reset_agent_context(token)

    def test_start_new_agent_context_with_parent(self) -> None:
        parent_ctx, parent_token = start_new_agent_context("parent_agent", {})
        try:
            child_ctx, child_token = start_new_agent_context("child_agent", {})
            try:
                assert child_ctx.agent_name == "child_agent"
                assert child_ctx.parent_span_id == parent_ctx.span_id
                assert get_agent_context() == child_ctx
            finally:
                reset_agent_context(child_token)
            assert get_agent_context() == parent_ctx
        finally:
            reset_agent_context(parent_token)
        assert get_agent_context() is None

    def test_agent_context_is_frozen(self) -> None:
        ctx, token = start_new_agent_context("test", {})
        try:
            with pytest.raises(Exception):
                ctx.span_id = "other"  # type: ignore[misc]
        finally:
            reset_agent_context(token)

    def test_nested_span_chain(self) -> None:
        """Test deeply nested spans maintain correct parent relationships."""
        tokens: list[Token[AgentContext | None]] = []
        contexts: list[AgentContext] = []

        for i in range(3):
            ctx, token = start_new_agent_context(f"agent_{i}", {})
            tokens.append(token)
            contexts.append(ctx)

        assert contexts[0].parent_span_id is None
        assert contexts[1].parent_span_id == contexts[0].span_id
        assert contexts[2].parent_span_id == contexts[1].span_id

        for token in reversed(tokens):
            reset_agent_context(token)

        assert get_agent_context() is None


class TestSubAgentAccumulator:
    def test_get_accumulator_returns_none_by_default(self) -> None:
        assert get_agent_context() is None

    def test_set_and_get_accumulator(self) -> None:
        accumulator: AgentAccumulator = {}
        _, token = start_new_agent_context("test_agent", accumulator)
        try:
            new_ctx = get_agent_context()
            assert new_ctx is not None
            assert new_ctx.accumulator is accumulator
        finally:
            reset_agent_context(token)
        assert get_agent_context() is None

    def test_accumulator_collects_results(self) -> None:
        accumulator: AgentAccumulator = {}
        _, token = start_new_agent_context("test_agent", accumulator)
        try:
            result = CompletionSuccess[str](
                agent_name="test",
                span_id="span-123",
                output="test_output",
                events=[],
                sub_agents={},
            )
            current = get_agent_context()
            assert current is not None
            current.accumulator.setdefault(result.agent_name, []).append(result)
            assert len(accumulator["test"]) == 1
            assert accumulator["test"][0].agent_name == "test"
        finally:
            reset_agent_context(token)


class TestRunCompletionNesting:
    @pytest.mark.asyncio
    async def test_reports_to_parent_accumulator_on_success(self) -> None:
        parent_accumulator: AgentAccumulator = {}
        _, token = start_new_agent_context("parent_agent", parent_accumulator)
        try:
            mock_agent = make_mock_agent("child_agent", "child")
            result = await run_test_completion("test", mock_agent)
            assert isinstance(result, CompletionSuccess)
            assert "child_agent" in parent_accumulator
            assert len(parent_accumulator["child_agent"]) == 1
            sub = parent_accumulator["child_agent"][0]
            assert isinstance(sub, CompletionSuccess)
            assert sub.agent_name == "child_agent"
            assert sub.status == "success"
            assert isinstance(sub.output, DummyOutput)
            assert sub.output.value == "child"
        finally:
            reset_agent_context(token)

    @pytest.mark.asyncio
    async def test_reports_to_parent_accumulator_on_failure(self) -> None:
        parent_accumulator: AgentAccumulator = {}
        _, token = start_new_agent_context("parent_agent", parent_accumulator)
        try:
            mock_agent = make_side_effect_agent("failing_child", RuntimeError("boom"))
            result = await run_test_completion("test", mock_agent)
            assert isinstance(result, CompletionFailure)
            assert "failing_child" in parent_accumulator
            sub = parent_accumulator["failing_child"][0]
            assert isinstance(sub, CompletionFailure)
            assert sub.status == "failure"
            assert sub.error is not None
            assert "boom" in sub.error.message
        finally:
            reset_agent_context(token)

    @pytest.mark.asyncio
    async def test_does_not_report_when_no_parent(self) -> None:
        assert get_agent_context() is None
        mock_agent = make_mock_agent("root_agent", "root")
        result = await run_test_completion("test", mock_agent)
        assert isinstance(result, CompletionSuccess)
        assert get_agent_context() is None

    @pytest.mark.asyncio
    async def test_nested_completion_collects_children(self) -> None:
        """Verify a parent run_completion sees sub-agents from nested calls."""

        async def fake_parent_run(_: str, **__: object) -> MagicMock:
            child_agent = make_mock_agent("child_agent", "child_result")
            await run_test_completion("child prompt", child_agent)
            return make_mock_result("parent_result")

        parent_agent = make_side_effect_agent("parent_agent", fake_parent_run)
        result = await run_test_completion("test", parent_agent)
        assert isinstance(result, CompletionSuccess)
        assert "child_agent" in result.sub_agents
        child_sub = result.sub_agents["child_agent"][0]
        assert isinstance(child_sub, CompletionSuccess)
        assert isinstance(child_sub.output, DummyOutput)
        assert child_sub.output.value == "child_result"
```

---

## test_sub_agent_nesting.py

```python
from collections.abc import Callable
from typing import Any
from unittest.mock import MagicMock

import pytest
from conftest import (
    make_mock_agent,
    make_mock_result,
    make_side_effect_agent,
    run_test_completion,
)

from ardoq_ai.completion.schemas.result import CompletionFailure, CompletionSuccess
from ardoq_ai.completion.span_context import (
    AgentAccumulator,
    get_agent_context,
)


def _make_delegating_run(
    child_name: str,
    child_side_effect: Callable[..., Any],
    result_value: str,
) -> Callable[..., Any]:
    async def run(_: str, **__: object) -> MagicMock:
        child = make_side_effect_agent(child_name, child_side_effect)
        await run_test_completion(child_name, child)
        return make_mock_result(result_value)
    return run


class TestThreeLayerNesting:
    @pytest.mark.asyncio
    async def test_three_layer_accumulators_expand_gradually(self) -> None:
        """Verify 3 layers of nested agents each have the expected accumulator.

        Structure: grandparent -> parent -> child
        Each layer only sees its direct children, not transitive ones.
        Accumulators grow gradually as children complete.
        """
        observed_accumulators: dict[str, AgentAccumulator | None] = {}

        async def fake_parent_run(_: str, **__: object) -> MagicMock:
            ctx = get_agent_context()
            assert ctx is not None
            observed_accumulators["parent_before_child"] = ctx.accumulator
            assert len(observed_accumulators["parent_before_child"]) == 0

            child = make_side_effect_agent("child_agent", fake_child_run)
            parent_result = await run_test_completion("child prompt", child)

            ctx = get_agent_context()
            assert ctx is not None
            observed_accumulators["parent_after_child"] = ctx.accumulator
            assert "child_agent" in observed_accumulators["parent_after_child"]
            assert len(observed_accumulators["parent_after_child"]["child_agent"]) == 1
            assert "grandchild_agent" not in observed_accumulators["parent_after_child"]

            assert isinstance(parent_result, CompletionSuccess)
            return make_mock_result("parent_result")

        async def fake_child_run(_: str, **__: object) -> MagicMock:
            ctx = get_agent_context()
            assert ctx is not None
            observed_accumulators["child_before_grandchild"] = ctx.accumulator
            assert len(observed_accumulators["child_before_grandchild"]) == 0

            grandchild = make_side_effect_agent("grandchild_agent", fake_grandchild_run)
            child_result = await run_test_completion("grandchild prompt", grandchild)

            ctx = get_agent_context()
            assert ctx is not None
            observed_accumulators["child_after_grandchild"] = ctx.accumulator
            assert "grandchild_agent" in observed_accumulators["child_after_grandchild"]

            assert isinstance(child_result, CompletionSuccess)
            return make_mock_result("child_result")

        async def fake_grandchild_run(_: str, **__: object) -> MagicMock:
            ctx = get_agent_context()
            observed_accumulators["grandchild"] = ctx.accumulator if ctx else None
            return make_mock_result("grandchild_result")

        root = make_side_effect_agent("parent_agent", fake_parent_run)
        result = await run_test_completion("start", root)

        assert isinstance(result, CompletionSuccess)
        assert result.agent_name == "parent_agent"
        assert result.output.value == "parent_result"

        assert "child_agent" in result.sub_agents
        assert len(result.sub_agents["child_agent"]) == 1
        assert "grandchild_agent" not in result.sub_agents

        parent_sub = result.sub_agents["child_agent"][0]
        assert isinstance(parent_sub, CompletionSuccess)
        assert parent_sub.agent_name == "child_agent"
        assert parent_sub.output.value == "child_result"

        assert "grandchild_agent" in parent_sub.sub_agents
        child_sub = parent_sub.sub_agents["grandchild_agent"][0]
        assert isinstance(child_sub, CompletionSuccess)
        assert child_sub.agent_name == "grandchild_agent"
        assert child_sub.output.value == "grandchild_result"
        assert child_sub.sub_agents == {}

        assert len({result.span_id, parent_sub.span_id, child_sub.span_id}) == 3
        assert get_agent_context() is None

    @pytest.mark.asyncio
    async def test_three_layer_with_multiple_children_at_mid_layer(self) -> None:
        """Structure: root -> mid -> {leaf_a, leaf_b}"""

        async def fake_mid_run(_: str, **__: object) -> MagicMock:
            ctx = get_agent_context()
            assert ctx is not None
            assert len(ctx.accumulator) == 0

            leaf_a = make_mock_agent("leaf_a", "a")
            leaf_b = make_mock_agent("leaf_b", "b")
            await run_test_completion("a", leaf_a)

            ctx = get_agent_context()
            assert ctx is not None
            assert "leaf_a" in ctx.accumulator
            assert "leaf_b" not in ctx.accumulator

            await run_test_completion("b", leaf_b)

            ctx = get_agent_context()
            assert ctx is not None
            assert "leaf_a" in ctx.accumulator
            assert "leaf_b" in ctx.accumulator

            return make_mock_result("mid_result")

        root_run = _make_delegating_run("mid_agent", fake_mid_run, "root_result")
        root = make_side_effect_agent("root_agent", root_run)
        result = await run_test_completion("start", root)

        assert isinstance(result, CompletionSuccess)
        assert result.output.value == "root_result"
        assert list(result.sub_agents.keys()) == ["mid_agent"]

        mid_sub = result.sub_agents["mid_agent"][0]
        assert isinstance(mid_sub, CompletionSuccess)
        assert mid_sub.output.value == "mid_result"
        assert "leaf_a" in mid_sub.sub_agents
        assert "leaf_b" in mid_sub.sub_agents
        assert mid_sub.sub_agents["leaf_a"][0].output.value == "a"
        assert mid_sub.sub_agents["leaf_b"][0].output.value == "b"
        assert get_agent_context() is None

    @pytest.mark.asyncio
    async def test_three_layer_with_mid_layer_failure(self) -> None:
        """When mid-layer fails after calling a child, both results are captured.

        Structure: root -> mid (fails) -> child (succeeds)
        """

        async def fake_mid_run(_: str, **__: object) -> MagicMock:
            child = make_mock_agent("child_agent", "child_ok")
            await run_test_completion("child", child)
            raise RuntimeError("mid exploded")

        root_run = _make_delegating_run("mid_agent", fake_mid_run, "root_result")
        root = make_side_effect_agent("root_agent", root_run)
        result = await run_test_completion("start", root)

        assert isinstance(result, CompletionSuccess)
        assert "mid_agent" in result.sub_agents
        mid_sub = result.sub_agents["mid_agent"][0]
        assert isinstance(mid_sub, CompletionFailure)
        assert "mid exploded" in mid_sub.error.message

        assert "child_agent" in mid_sub.sub_agents
        child_sub = mid_sub.sub_agents["child_agent"][0]
        assert isinstance(child_sub, CompletionSuccess)
        assert child_sub.output.value == "child_ok"
        assert get_agent_context() is None


if __name__ == "__main__":
    pytest.main()
```

---

## test_streaming_sub_agent.py

```python
from typing import Any
from unittest.mock import MagicMock

import pytest
from conftest import (
    DummyDeps,
    DummyOutput,
    make_mock_agent,
    make_side_effect_agent,
    run_test_completion,
)

from ardoq_ai.completion.schemas.message import Message
from ardoq_ai.completion.schemas.result import CompletionFailure, CompletionSuccess
from ardoq_ai.completion.span_context import (
    AgentAccumulator,
    get_agent_context,
    reset_agent_context,
    start_new_agent_context,
)
from ardoq_ai.completion.streaming import run_completion_streaming_events


def make_streaming_agent(name: str, output: str) -> MagicMock:
    agent = MagicMock()
    agent.name = name
    mock_result = MagicMock()
    mock_result.output = output
    mock_result.usage.return_value = MagicMock(input_tokens=1, output_tokens=1, total_tokens=2)

    async def mock_stream(*args: Any, **kwargs: Any):
        from pydantic_ai import AgentRunResultEvent
        event = MagicMock(spec=AgentRunResultEvent)
        event.result = mock_result
        yield event

    agent.run_stream_events = mock_stream
    return agent


async def collect_stream_events(agent: MagicMock, prompt: str = "test") -> list[Any]:
    events: list[Any] = []
    async for event in run_completion_streaming_events(
        new_message=Message(role="user", content=prompt),
        agent=agent,
        model=MagicMock(),
        logger=MagicMock(),
        dependencies=DummyDeps(),
    ):
        events.append(event)
    return events


class TestStreamingContextTracking:
    @pytest.mark.asyncio
    async def test_streaming_sets_up_and_cleans_up_context(self) -> None:
        assert get_agent_context() is None
        agent = make_streaming_agent("test_agent", "result")
        await collect_stream_events(agent)
        assert get_agent_context() is None

    @pytest.mark.asyncio
    async def test_streaming_yields_completion_success_as_final_event(self) -> None:
        agent = make_streaming_agent("test_agent", "result")
        events = await collect_stream_events(agent)
        assert len(events) >= 1
        final = events[-1]
        assert isinstance(final, CompletionSuccess)
        assert final.agent_name == "test_agent"
        assert final.span_id is not None
        assert final.sub_agents == {}
        assert final.events == []

    @pytest.mark.asyncio
    async def test_streaming_message_has_span_info(self) -> None:
        agent = make_streaming_agent("test_agent", "hello")
        events = await collect_stream_events(agent)
        messages = [e for e in events if isinstance(e, Message)]
        assert len(messages) == 1
        assert messages[0].content == "hello"


class TestStreamingSubAgentAccumulation:
    @pytest.mark.asyncio
    async def test_streaming_collects_sub_agent_results(self) -> None:
        async def fake_stream_with_sub_agent(*args: Any, **kwargs: Any):
            from pydantic_ai import AgentRunResultEvent
            child = make_mock_agent("child_agent", "child_result")
            await run_test_completion("child prompt", child)
            mock_result = MagicMock()
            mock_result.output = "parent_result"
            mock_result.usage.return_value = MagicMock(input_tokens=1, output_tokens=1, total_tokens=2)
            event = MagicMock(spec=AgentRunResultEvent)
            event.result = mock_result
            yield event

        agent = MagicMock()
        agent.name = "parent_agent"
        agent.run_stream_events = fake_stream_with_sub_agent
        events = await collect_stream_events(agent)
        final = events[-1]
        assert isinstance(final, CompletionSuccess)
        assert "child_agent" in final.sub_agents
        child_sub = final.sub_agents["child_agent"][0]
        assert isinstance(child_sub, CompletionSuccess)
        assert isinstance(child_sub.output, DummyOutput)
        assert child_sub.output.value == "child_result"

    @pytest.mark.asyncio
    async def test_streaming_collects_multiple_sub_agents(self) -> None:
        async def fake_stream_with_multiple_children(*args: Any, **kwargs: Any):
            from pydantic_ai import AgentRunResultEvent
            child_a = make_mock_agent("child_a", "a")
            child_b = make_mock_agent("child_b", "b")
            await run_test_completion("a", child_a)
            await run_test_completion("b", child_b)
            mock_result = MagicMock()
            mock_result.output = "parent"
            mock_result.usage.return_value = MagicMock(input_tokens=1, output_tokens=1, total_tokens=2)
            event = MagicMock(spec=AgentRunResultEvent)
            event.result = mock_result
            yield event

        agent = MagicMock()
        agent.name = "parent_agent"
        agent.run_stream_events = fake_stream_with_multiple_children
        events = await collect_stream_events(agent)
        final = events[-1]
        assert isinstance(final, CompletionSuccess)
        assert "child_a" in final.sub_agents
        assert "child_b" in final.sub_agents
        assert final.sub_agents["child_a"][0].output.value == "a"
        assert final.sub_agents["child_b"][0].output.value == "b"

    @pytest.mark.asyncio
    async def test_streaming_reports_to_parent_accumulator(self) -> None:
        parent_accumulator: AgentAccumulator = {}
        _, token = start_new_agent_context("parent_agent", parent_accumulator)
        try:
            agent = make_streaming_agent("child_stream", "result")
            await collect_stream_events(agent)
            assert "child_stream" in parent_accumulator
            sub = parent_accumulator["child_stream"][0]
            assert isinstance(sub, CompletionSuccess)
            assert sub.agent_name == "child_stream"
        finally:
            reset_agent_context(token)

    @pytest.mark.asyncio
    async def test_streaming_collects_failed_sub_agent(self) -> None:
        async def fake_stream_with_failing_child(*args: Any, **kwargs: Any):
            from pydantic_ai import AgentRunResultEvent
            child = make_side_effect_agent("failing_child", RuntimeError("boom"))
            await run_test_completion("child", child)
            mock_result = MagicMock()
            mock_result.output = "parent_ok"
            mock_result.usage.return_value = MagicMock(input_tokens=1, output_tokens=1, total_tokens=2)
            event = MagicMock(spec=AgentRunResultEvent)
            event.result = mock_result
            yield event

        agent = MagicMock()
        agent.name = "parent_agent"
        agent.run_stream_events = fake_stream_with_failing_child
        events = await collect_stream_events(agent)
        final = events[-1]
        assert isinstance(final, CompletionSuccess)
        assert "failing_child" in final.sub_agents
        child_sub = final.sub_agents["failing_child"][0]
        assert isinstance(child_sub, CompletionFailure)
        assert "boom" in child_sub.error.message


class TestStreamingSpanInfo:
    @pytest.mark.asyncio
    async def test_streaming_completion_has_unique_span_id(self) -> None:
        agent = make_streaming_agent("test_agent", "result")
        events_1 = await collect_stream_events(agent)
        events_2 = await collect_stream_events(agent)
        final_1 = events_1[-1]
        final_2 = events_2[-1]
        assert isinstance(final_1, CompletionSuccess)
        assert isinstance(final_2, CompletionSuccess)
        assert final_1.span_id != final_2.span_id

    @pytest.mark.asyncio
    async def test_streaming_no_parent_span_at_top_level(self) -> None:
        assert get_agent_context() is None
        agent = make_streaming_agent("test_agent", "result")
        events = await collect_stream_events(agent)
        final = events[-1]
        assert isinstance(final, CompletionSuccess)
        assert final.span_id is not None


class TestStreamingCatchAllException:
    def _make_raising_streaming_agent(self, name: str, exc: Exception) -> MagicMock:
        agent = MagicMock()
        agent.name = name

        async def raising_stream(*args: Any, **kwargs: Any):
            raise exc
            yield

        agent.run_stream_events = raising_stream
        return agent

    @pytest.mark.asyncio
    async def test_unexpected_exception_reports_failure_to_parent(self) -> None:
        parent_accumulator: AgentAccumulator = {}
        _, token = start_new_agent_context("parent_agent", parent_accumulator)
        try:
            agent = self._make_raising_streaming_agent("child_stream", RuntimeError("unexpected"))
            with pytest.raises(RuntimeError, match="unexpected"):
                await collect_stream_events(agent)
            assert "child_stream" in parent_accumulator
            child_result = parent_accumulator["child_stream"][0]
            assert isinstance(child_result, CompletionFailure)
            assert "unexpected" in child_result.error.message
        finally:
            reset_agent_context(token)

    @pytest.mark.asyncio
    async def test_unexpected_exception_propagates_at_top_level(self) -> None:
        assert get_agent_context() is None
        agent = self._make_raising_streaming_agent("top_level_agent", ValueError("kaboom"))
        with pytest.raises(ValueError, match="kaboom"):
            await collect_stream_events(agent)
        assert get_agent_context() is None
```
