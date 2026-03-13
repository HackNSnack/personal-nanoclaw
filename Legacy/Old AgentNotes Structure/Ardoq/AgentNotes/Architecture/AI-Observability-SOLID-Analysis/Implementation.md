# SOLID Implementation Details

## Directory Structure Enforcing SOLID

```
ai_observability/src/
├── interfaces/                          # DIP: All abstractions here
│   ├── evaluators/
│   │   ├── i_context_metric_evaluator.py       # ISP: Context metrics
│   │   ├── i_tool_metric_evaluator.py          # ISP: Tool metrics
│   │   ├── i_answer_metric_evaluator.py        # ISP: Answer metrics
│   │   └── i_custom_metric_evaluator.py        # ISP: Custom metrics
│   ├── orchestrators/
│   │   └── i_eval_orchestrator.py              # DIP: Orchestration abstraction
│   └── repositories/
│       └── i_dataset_repository.py             # DIP: Data access abstraction
│
├── implementations/                     # Concrete SOLID implementations
│   ├── evaluators/
│   │   ├── base_deepeval_metric_evaluator.py   # SRP: Shared deepeval logic
│   │   ├── context_metric_evaluator.py         # SRP: Only context metrics
│   │   ├── tool_metric_evaluator.py            # SRP: Only tool metrics
│   │   ├── answer_metric_evaluator.py          # SRP: Only answer metrics
│   │   └── litellm_metric_evaluator.py         # Composite: All metric types
│   ├── metrics/
│   │   ├── metric_registry.py                  # OCP: Extensible metric routing
│   │   └── metric_handler.py                   # SRP: Metric validation
│   └── orchestrators/
│       └── eval_orchestrator.py                # SRP: Metric evaluation orchestration
│
├── domain/                              # Pure domain models (no framework deps)
│   ├── data/
│   │   └── record.py                           # Record: evaluation input
│   └── eval/
│       ├── metric.py                           # Enum: Available metrics
│       ├── result.py                           # EvalResult: evaluation output
│       └── output.py
│
├── api/
│   ├── routers/
│   │   └── simple_router.py                    # DIP: Routes depend on IEvalOrchestrator
│   └── domain/
│       ├── requests/
│       │   └── base_eval_request.py            # API input models
│       └── responses/
│           └── eval_response.py                # API output models
│
└── config/
    └── dependency_injection/                   # DIP: Central configuration point
        ├── evaluators/                         # Factory for evaluators
        ├── orchestrators/                      # Factory for orchestrators
        └── repositories/                       # Factory for repositories
```

---

## 1. DIP: How Dependency Inversion Works

### Flow: Request → Interface → Implementation

**Step 1: HTTP Route (simple_router.py)**
```python
@simple_router.post("/")
async def submit_eval(
    req: MetricEvalRequest,
    orchestrator: EvalOrchestratorDep  # FastAPI injects interface, not concrete class
) -> MetricEvalResponse:
    return MetricEvalResponse(
        results=await orchestrator.eval_metrics(req.record, req.eval_model, req.metrics)
    )
```
- Route depends on `IEvalOrchestrator` interface
- Doesn't know about EvaluationOrchestrator, deepeval, or litellm
- FastAPI DI injects concrete implementation

**Step 2: Orchestrator Factory (dependency_injection/orchestrators/__init__.py)**
```python
def get_eval_orchestrator() -> IEvalOrchestrator:
    evaluator = get_litellm_metric_evaluator()
    return EvaluationOrchestrator(
        answer_evaluator=evaluator,
        context_evaluator=evaluator,
        tool_evaluator=evaluator,  # Could be different implementations
    )
```
- Factory creates concrete EvaluationOrchestrator
- Returns it typed as IEvalOrchestrator interface
- Only factory knows about concrete class

**Step 3: Orchestrator (implementations/orchestrators/eval_orchestrator.py)**
```python
class EvaluationOrchestrator(IEvalOrchestrator):
    def __init__(
        self,
        answer_evaluator: IAnswerMetricEvaluator,    # Depends on interface
        context_evaluator: IContextMetricEvaluator,  # Depends on interface
        tool_evaluator: IToolMetricEvaluator,        # Depends on interface
    ):
        # Doesn't care if deepeval, pydantic_ai, or mock
```
- Orchestrator receives interfaces
- Uses them without knowing concrete type
- Full substitution flexibility

### Dependency Graph
```
HTTP Request
    ↓
FastAPI Dependency Injection
    ↓ Looks up EvalOrchestratorDep
    ↓
dependency_injection/orchestrators/get_eval_orchestrator()
    ↓
Returns IEvalOrchestrator (typed as interface)
    ↓
Actual type: EvaluationOrchestrator
    ↓ Takes IContextMetricEvaluator, IToolMetricEvaluator, etc.
    ↓
dependency_injection/evaluators/get_litellm_metric_evaluator()
    ↓
Returns IContextMetricEvaluator (typed as interface)
    ↓
Actual type: ContextMetricEvaluator (extends IContextMetricEvaluator)
```

---

## 2. ISP: Segregated Interface Design

### Why Not One Monolithic Interface?

**❌ Anti-pattern (violates ISP):**
```python
class IEvaluator(ABC):
    # Any implementation must implement ALL metrics
    @abstractmethod
    async def calculate_hallucination(...) -> MetricEvalResult: ...
    @abstractmethod
    async def calculate_faithfulness(...) -> MetricEvalResult: ...
    @abstractmethod
    async def calculate_tool_correctness(...) -> MetricEvalResult: ...
    # ... 7 more methods
```

**✓ SOLID pattern (segregated interfaces):**
```python
# Interface 1: Context metrics only
class IContextMetricEvaluator(ABC):
    @abstractmethod
    async def calculate_hallucination(...) -> MetricEvalResult: ...
    @abstractmethod
    async def calculate_faithfulness(...) -> MetricEvalResult: ...
    @abstractmethod
    async def calculate_contextual_precision(...) -> MetricEvalResult: ...
    # 5 methods, all related to context

# Interface 2: Tool metrics only
class IToolMetricEvaluator(ABC):
    @abstractmethod
    async def calculate_tool_correctness(...) -> MetricEvalResult: ...
    # 1 method, focused

# Composition: Full evaluator
class LiteLLMMetricEvaluator(
    IContextMetricEvaluator,  # Implements all context metrics
    IToolMetricEvaluator,      # Implements tool metrics
    IAnswerMetricEvaluator,    # Implements answer metrics
):
    pass
```

### Benefits
- **Minimal implementations**: Implement only needed metrics
- **Clear responsibility**: File name matches what it does
- **Easy testing**: Mock only relevant interface
- **Future-proof**: Add new metric category without touching existing

---

## 3. SRP: Single Responsibility Examples

### Evaluator Responsibilities

**ContextMetricEvaluator (src/implementations/evaluators/context_metric_evaluator.py)**
- **Single Responsibility:** Evaluate context-based metrics using deepeval
- **Reason to Change:** How deepeval context metrics work changes (API/method names)
- **Methods:** 5 context metric calculations

**ToolMetricEvaluator**
- **Single Responsibility:** Evaluate tool invocation correctness
- **Reason to Change:** Tool evaluation logic/API changes
- **Methods:** 1 tool metric calculation

**EvaluationOrchestrator (src/implementations/orchestrators/eval_orchestrator.py)**
- **Single Responsibility:** Coordinate concurrent evaluation of multiple metrics
- **Reason to Change:** Parallelization strategy changes (asyncio → ray distributed)
- **Methods:** eval_metrics, _evaluate_metrics, _validate_data, _create_error_metric_result

### Example: Deepeval API Changes
If deepeval updates its HallucinationMetric API:

**Before (wrong - SRP violated):**
```python
# Both EvaluationOrchestrator AND ContextMetricEvaluator need changes
class EvaluationOrchestrator:
    async def eval_metrics(self, ...):
        # Code using deepeval API directly
        metric = HallucinationMetric(new_api_parameter=True)
        
class ContextMetricEvaluator:
    async def calculate_hallucination(...):
        metric = HallucinationMetric(new_api_parameter=True)
```

**After (correct - SRP enforced):**
```python
# Only ContextMetricEvaluator needs change
class ContextMetricEvaluator(IContextMetricEvaluator):
    async def calculate_hallucination(...):
        metric = HallucinationMetric(new_api_parameter=True)  # Updated here
        
class EvaluationOrchestrator(IEvalOrchestrator):
    # No changes - depends on interface, not implementation
    async def eval_metrics(self, ...):
        # Still calls context_evaluator.calculate_hallucination()
```

---

## 4. OCP: Open/Closed Principle in Action

### Adding New Metric Without Modification

**Scenario:** Add BIAS_DETECTION metric

**Step 1: Extend Metric Enum (domain/eval/metric.py)**
```python
class Metric(StrEnum):
    # ... existing metrics
    BIAS_DETECTION = "bias_detection"  # NEW
```

**Step 2: Add to Interface (interfaces/evaluators/i_custom_metric_evaluator.py)**
```python
class ICustomMetricEvaluator(ABC):
    @abstractmethod
    async def calculate_bias_detection(...) -> MetricEvalResult:  # NEW
        raise NotImplementedError()
```

**Step 3: Implement (implementations/evaluators/custom_metric_evaluator.py)**
```python
class CustomMetricEvaluator(ICustomMetricEvaluator):
    async def calculate_bias_detection(self, ...) -> MetricEvalResult:  # NEW
        # Custom evaluation logic
        pass
```

**Step 4: Register (implementations/metrics/metric_registry.py)**
```python
def _register_metrics(self) -> None:
    # ... existing registrations
    
    if self.custom_evaluator is not None:
        self.register_metric(
            MetricHandler(
                metric=Metric.BIAS_DETECTION,  # NEW
                required_fields={MetricRequirement.ACTUAL_OUTPUT},
                executor=self._execute_bias_detection,  # NEW
            )
        )
    
    async def _execute_bias_detection(self, model_name: str, record: Record) -> MetricEvalResult:  # NEW
        return await self.custom_evaluator.calculate_bias_detection(...)
```

**Result:** Files Modified:
- ✏️ metric.py (Metric enum)
- ✏️ i_custom_metric_evaluator.py (interface)
- ✏️ custom_metric_evaluator.py (implementation)
- ✏️ metric_registry.py (registration)

**Files Unchanged (CLOSED):**
- ✓ eval_orchestrator.py
- ✓ simple_router.py
- ✓ All other evaluators
- ✓ API dependency injection

### Why This is OCP
- **Open for Extension:** Add new metrics by extending interfaces/implementations
- **Closed for Modification:** Existing orchestrator, routers, factories never touched
- **Low Risk:** No risk of breaking existing metrics

---

## 5. LSP: Liskov Substitution at Boundaries

### Substitution Points

**Point 1: Evaluator Substitution**
```python
# In DI factory
def get_eval_orchestrator() -> IEvalOrchestrator:
    # Current: deepeval-based
    evaluator = get_litellm_metric_evaluator()  # LiteLLMMetricEvaluator
    
    # Future: could be pydantic_ai-based
    # evaluator = get_pydantic_ai_metric_evaluator()  # PydanticAIMetricEvaluator
    
    # During tests: mock
    # evaluator = MockMetricEvaluator()
    
    return EvaluationOrchestrator(
        answer_evaluator=evaluator,
        context_evaluator=evaluator,
        tool_evaluator=evaluator,
    )
```

**Point 2: Orchestrator Substitution**
```python
# API router doesn't care which orchestrator
@router.post("/")
async def submit_eval(
    req: MetricEvalRequest,
    orchestrator: IEvalOrchestrator,  # Could be any IEvalOrchestrator
) -> MetricEvalResponse:
    # Works with EvaluationOrchestrator or MockEvaluationOrchestrator
    results = await orchestrator.eval_metrics(...)
```

### Contract Guarantees
```python
# All IContextMetricEvaluator implementations must:
# 1. Accept same parameters
# 2. Return MetricEvalResult
# 3. Be async (use await)
# 4. Handle all required context metrics

# If any implementation breaks contract:
# - Different parameter types → Type checker catches it
# - Missing metric → Interface definition catches it
# - Not async → Runtime error, obvious in tests
```

---

## Testing Implications

### Unit Testing with LSP
```python
class MockContextMetricEvaluator(IContextMetricEvaluator):
    async def calculate_hallucination(...) -> MetricEvalResult:
        return MetricEvalResult(
            metric=Metric.HALLUCINATION,
            result=EvalResult(score=0.95, passed=True, ...)
        )

# In test
def test_eval_orchestrator():
    orchestrator = EvaluationOrchestrator(
        answer_evaluator=MockAnswerMetricEvaluator(),
        context_evaluator=MockContextMetricEvaluator(),  # Mock, not real
        tool_evaluator=MockToolMetricEvaluator(),
    )
    
    # Runs without LLM calls, deterministic results
    result = await orchestrator.eval_metrics(record, "gpt-4", [Metric.HALLUCINATION])
    assert result[0].result.score == 0.95
```

---

## Migration Path: Swapping Evaluation Backend

**Current State:** deepeval-based evaluators

**Goal:** Migrate to Pydantic AI

**Steps (SOLID enables this):**

1. Create new implementations (Pydantic AI-based):
   - `pydantic_ai_context_metric_evaluator.py`
   - `pydantic_ai_tool_metric_evaluator.py`
   - `pydantic_ai_metric_evaluator.py` (composite)

2. Update DI factory:
   ```python
   # change this:
   evaluator = get_litellm_metric_evaluator()
   
   # to this:
   evaluator = get_pydantic_ai_metric_evaluator()
   ```

3. No changes needed to:
   - Orchestrator
   - Routes
   - Domain models
   - Tests (if well-written against interfaces)

**Result:** Complete backend migration, zero business logic changes ✓
