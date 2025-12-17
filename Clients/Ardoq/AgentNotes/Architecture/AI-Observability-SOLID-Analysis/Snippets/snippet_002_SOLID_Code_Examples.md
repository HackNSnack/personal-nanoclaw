# SOLID Code Examples - Real Implementation

## DIP Example: Orchestrator Constructor

**Location:** `src/implementations/orchestrators/eval_orchestrator.py:11-25`

```python
class EvaluationOrchestrator(IEvalOrchestrator):
    def __init__(
        self,
        answer_evaluator: IAnswerMetricEvaluator,      # ← Interface, not class
        context_evaluator: IContextMetricEvaluator,    # ← Interface, not class
        tool_evaluator: IToolMetricEvaluator,          # ← Interface, not class
    ) -> None:
        self.context_evaluator = context_evaluator
        self.tool_evaluator = tool_evaluator
        self.registry = MetricRegistry(
            answer_evaluator=answer_evaluator,
            context_evaluator=context_evaluator,
            tool_evaluator=tool_evaluator,
        )
```

**Why DIP Works Here:**
- Constructor accepts interfaces, not `ContextMetricEvaluator` class
- Can inject `MockContextMetricEvaluator` or `PydanticAIContextMetricEvaluator`
- Orchestrator doesn't know/care about specific implementation
- In tests: inject mocks without touching production code

**Usage in DI Factory:**
```python
def get_eval_orchestrator() -> IEvalOrchestrator:
    evaluator = get_litellm_metric_evaluator()  # Returns composite impl
    return EvaluationOrchestrator(
        answer_evaluator=evaluator,
        context_evaluator=evaluator,  # Could be different impl
        tool_evaluator=evaluator,
    )
```

---

## ISP Example: Segregated Interfaces

**Context Metrics Interface**
`src/interfaces/evaluators/i_context_metric_evaluator.py:1-64`

```python
from abc import ABC, abstractmethod
from ardoq_ai.domain import Context
from src.domain import MetricEvalResult

class IContextMetricEvaluator(ABC):
    @abstractmethod
    async def calculate_hallucination(
        self,
        model_name: str,
        text_input: str,
        actual_output: str,
        context: Context,
        threshold: float = 0.5,
    ) -> MetricEvalResult:
        raise NotImplementedError()

    @abstractmethod
    async def calculate_faithfulness(
        self,
        model_name: str,
        text_input: str,
        actual_output: str,
        context: Context,
        threshold: float = 0.5,
    ) -> MetricEvalResult:
        raise NotImplementedError()

    # ... 3 more context metrics
```

**Tool Metrics Interface**
`src/interfaces/evaluators/i_tool_metric_evaluator.py:1-21`

```python
from abc import ABC, abstractmethod
from ardoq_ai.domain import Tool, ToolResult
from src.domain import MetricEvalResult

class IToolMetricEvaluator(ABC):
    @abstractmethod
    async def calculate_tool_correctness(
        self,
        model_name: str,
        text_input: str,
        actual_output: str,
        expected_invoked_tools: list[Tool | ToolResult],
        actual_invoked_tools: list[ToolResult],
        threshold: float = 0.5,
    ) -> MetricEvalResult:
        raise NotImplementedError()
```

**Why ISP Works Here:**
- If you only do context evaluation: implement IContextMetricEvaluator
- If you only do tool evaluation: implement IToolMetricEvaluator
- No need to implement all metrics
- Composite class (LiteLLMMetricEvaluator) can implement all three

```python
class LiteLLMMetricEvaluator(
    IContextMetricEvaluator,
    IToolMetricEvaluator,
    IAnswerMetricEvaluator,
):
    # Can implement context, tool, and answer metrics
    # Minimal = just context? → Implement IContextMetricEvaluator only
```

---

## SRP Example: Single Responsibility Classes

**ContextMetricEvaluator - Only Context Metrics**
`src/implementations/evaluators/context_metric_evaluator.py:1-40`

```python
from typing import override
from ardoq_ai.domain import Context
from deepeval.metrics import HallucinationMetric
from src.domain import Metric, MetricEvalResult
from src.implementations.evaluators.base_deepeval_metric_evaluator import BaseDeepEvalMetricEvaluator
from src.interfaces.evaluators import IContextMetricEvaluator

class ContextMetricEvaluator(IContextMetricEvaluator, BaseDeepEvalMetricEvaluator):
    @override
    async def calculate_hallucination(
        self,
        model_name: str,
        text_input: str,
        actual_output: str,
        context: Context | None = None,
        threshold: float = 0.5,
    ) -> MetricEvalResult:
        return await self._create_single_turn_case_and_measure(
            text_input=text_input,
            context=context,
            actual_output=actual_output,
            threshold=threshold,
            deepeval_metric=HallucinationMetric(
                threshold=threshold,
                model=self._get_model(model_name),
            ),
            metric=Metric.HALLUCINATION,
        )
```

**SRP Analysis:**
- **Single Responsibility:** Evaluate context metrics using deepeval
- **Reason to Change:** When deepeval context metric API changes
- **Not Responsible For:**
  - Tool evaluation (that's ToolMetricEvaluator)
  - Orchestration (that's EvaluationOrchestrator)
  - HTTP routing (that's simple_router)

**Benefit:**
If deepeval changes HallucinationMetric API:
```python
# Only change here:
class ContextMetricEvaluator:
    async def calculate_hallucination(...):
        metric = HallucinationMetric(
            threshold=threshold,
            model=self._get_model(model_name),
            # NEW_API_PARAMETER=True
        )
        
# No changes needed in:
# - EvaluationOrchestrator
# - MetricRegistry
# - Routes
# - Tests of orchestrator
```

---

## OCP Example: MetricRegistry Extension

**Current: Registering Context Metrics**
`src/implementations/metrics/metric_registry.py:37-97`

```python
def _register_metrics(self) -> None:
    if self.context_evaluator is not None:
        self.register_metric(
            MetricHandler(
                metric=Metric.HALLUCINATION,
                required_fields={
                    MetricRequirement.ACTUAL_OUTPUT,
                    MetricRequirement.CONTEXT,
                },
                executor=self._execute_hallucination,
            )
        )
        self.register_metric(
            MetricHandler(
                metric=Metric.FAITHFULNESS,
                required_fields={
                    MetricRequirement.ACTUAL_OUTPUT,
                    MetricRequirement.CONTEXT,
                },
                executor=self._execute_faithfulness,
            )
        )
        # ... more metrics
```

**Adding New Metric: SEMANTIC_SIMILARITY**

Without OCP (❌ Wrong - Modify existing code):
```python
# WRONG: Modify EvaluationOrchestrator
class EvaluationOrchestrator:
    async def eval_metrics(self, ...):
        if Metric.SEMANTIC_SIMILARITY in metrics:
            result = await self.context_evaluator.calculate_semantic_similarity(...)
            results.append(result)
```

With OCP (✓ Right - Extend existing code):
```python
# RIGHT: Only modify MetricRegistry (extension point)

# Step 1: Add to interface (i_context_metric_evaluator.py)
class IContextMetricEvaluator(ABC):
    @abstractmethod
    async def calculate_semantic_similarity(...) -> MetricEvalResult:
        raise NotImplementedError()

# Step 2: Implement (context_metric_evaluator.py)
class ContextMetricEvaluator(IContextMetricEvaluator):
    async def calculate_semantic_similarity(...):
        metric = SemanticSimilarityMetric(...)
        return await self._create_single_turn_case_and_measure(...)

# Step 3: Register (metric_registry.py)
def _register_metrics(self) -> None:
    # ... existing registrations
    self.register_metric(
        MetricHandler(
            metric=Metric.SEMANTIC_SIMILARITY,  # NEW
            required_fields={MetricRequirement.ACTUAL_OUTPUT},
            executor=self._execute_semantic_similarity,  # NEW
        )
    )

# Step 4: Add executor method (metric_registry.py)
async def _execute_semantic_similarity(self, model_name: str, record: Record) -> MetricEvalResult:
    return await self.context_evaluator.calculate_semantic_similarity(...)
```

**OCP Benefit:**
- ✓ EvaluationOrchestrator.eval_metrics() unchanged
- ✓ simple_router.py unchanged
- ✓ Existing tests unaffected
- ✓ New metric safe to deploy independently

**Files Modified:** 4 (interface, implementation, registry, executor)
**Files Unchanged:** 10+ (orchestrator, routes, factories, other evaluators, etc.)

---

## LSP Example: Substitutable Implementations

**Interface Contract:**
```python
class IContextMetricEvaluator(ABC):
    async def calculate_hallucination(
        self,
        model_name: str,
        text_input: str,
        actual_output: str,
        context: Context,
        threshold: float = 0.5,
    ) -> MetricEvalResult:
        raise NotImplementedError()
```

**Implementation 1: Deepeval-based (Production)**
```python
class ContextMetricEvaluator(IContextMetricEvaluator):
    async def calculate_hallucination(self, ...) -> MetricEvalResult:
        metric = HallucinationMetric(model=self._get_model(model_name))
        case = LLMTestCase(input=text_input, actual_output=actual_output, context=...)
        score = await metric.a_measure(case)
        return MetricEvalResult(
            metric=Metric.HALLUCINATION,
            result=EvalResult(score=score.score, passed=score.score > threshold, ...)
        )
```

**Implementation 2: Mock (Testing)**
```python
class MockContextMetricEvaluator(IContextMetricEvaluator):
    async def calculate_hallucination(self, ...) -> MetricEvalResult:
        # Deterministic, no LLM calls
        return MetricEvalResult(
            metric=Metric.HALLUCINATION,
            result=EvalResult(score=0.95, passed=True, reasoning="Mocked")
        )
```

**Implementation 3: Pydantic AI-based (Future)**
```python
class PydanticAIContextMetricEvaluator(IContextMetricEvaluator):
    async def calculate_hallucination(self, ...) -> MetricEvalResult:
        agent = Agent(system_prompt="Evaluate hallucination...")
        result = await agent.run(...)
        return MetricEvalResult(
            metric=Metric.HALLUCINATION,
            result=EvalResult(score=..., passed=..., ...)
        )
```

**LSP in Action:**
```python
# In production DI factory
def get_eval_orchestrator() -> IEvalOrchestrator:
    evaluator = ContextMetricEvaluator()  # Deepeval
    return EvaluationOrchestrator(context_evaluator=evaluator)

# In unit tests
def test_hallucination_scoring():
    mock_evaluator = MockContextMetricEvaluator()
    orchestrator = EvaluationOrchestrator(context_evaluator=mock_evaluator)
    result = await orchestrator.eval_metrics(...)
    assert result[0].result.score == 0.95  # Deterministic

# In future migration to Pydantic AI
def get_eval_orchestrator() -> IEvalOrchestrator:
    evaluator = PydanticAIContextMetricEvaluator()  # New impl
    return EvaluationOrchestrator(context_evaluator=evaluator)  # No other changes!
```

**LSP Guarantees:**
- All implementations have same signature
- All return MetricEvalResult (same structure)
- All are async
- All handle Context parameter same way
- All respect threshold parameter

Result: **Complete substitutability** ✓

---

## Data Model: Record (Domain Purity)

**Location:** `src/domain/data/record.py`

```python
from typing import Any
from ardoq_ai.domain import Context, Tool, ToolResult
from pydantic import BaseModel

class Record(BaseModel):
    input: str
    actual_output: str | None = None
    expected_output: str | None = None
    context: Context | None = None
    retrieval_context: Context | None = None
    metadata: dict[str, Any] | None = None
    actual_tools: list[ToolResult] | None = None
    expected_tools: list[Tool | ToolResult] | None = None
```

**Why This Is SOLID:**
- **No framework dependencies** - Only Pydantic (for serialization, not core logic)
- **Pure domain** - Can be used in CLI, tests, alternative backends
- **Clear responsibility** - Represents evaluation input
- **Extensible** - Add fields without affecting orchestrator
- **Interfaces depend on it** - IContextMetricEvaluator uses Context, not deepeval objects

**Usage Across System:**
```python
# API Layer: Deserialize from JSON
record = Record(**request_json)

# Orchestration Layer: Pass to evaluators
result = await context_evaluator.calculate_hallucination(
    ...,
    context=record.context,
    actual_output=record.actual_output,
    ...
)

# Testing: Create manually
record = Record(
    input="What is Python?",
    actual_output="A snake species",
    context=Context(elements=[...]),
)
```

---

## Metric Enum: Single Source of Truth

**Location:** `src/domain/eval/metric.py`

```python
from enum import StrEnum

class Metric(StrEnum):
    ANSWER_RELEVANCY = "answer_relevancy"
    FAITHFULNESS = "faithfulness"
    HALLUCINATION = "hallucination"
    CONTEXTUAL_PRECISION = "contextual_precision"
    CONTEXTUAL_RECALL = "contextual_recall"
    CONTEXTUAL_RELEVANCY = "contextual_relevancy"
    TOOL_CORRECTNESS = "tool_correctness"
```

**SOLID Application:**
- **Single Source of Truth** - All metrics in one place
- **Type Safe** - Can't use undefined metrics
- **Extensible** - Add new metrics to enum
- **Used Everywhere:**
  - Interface definitions
  - MetricRegistry routing
  - API validation
  - Domain models

**Adding Metric:**
```python
class Metric(StrEnum):
    # ... existing
    BIAS_DETECTION = "bias_detection"  # Add one line

# Everything else cascades:
# 1. Add method to interface (ICustomMetricEvaluator)
# 2. Implement in class (CustomMetricEvaluator)
# 3. Register in MetricRegistry
# 4. That's it!
```
