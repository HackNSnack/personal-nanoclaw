# Related Issues & Architectural Connections

## Connected Components & Systems

### 1. Within ai_observability
```
interfaces/
  ├── evaluators/          ← Core SOLID contracts
  └── orchestrators/

implementations/
  ├── evaluators/          ← SOLID implementations
  ├── metrics/
  │   └── MetricRegistry   ← Drives OCP
  └── orchestrators/       ← Uses MetricRegistry

api/
  └── routers/             ← Depends on IEvalOrchestrator (DIP)

config/
  └── dependency_injection/ ← Wires everything via interfaces (DIP)

domain/                    ← Framework-agnostic models (supports SRP)
```

### 2. Cross-Project: ardoq_ai Shared Library

**Location:** `libs/ardoq_ai/`

**Provides to ai_observability:**
- `Context` domain model (used in record.py, evaluators)
- `Tool`, `ToolResult` domain models (for tool evaluation)
- `ILLMClient` interface (DIP in ardoq_ai)
- `IArdoqAPIClient` interface (DIP for graph queries)

**SOLID Connection:**
- ardoq_ai follows same DIP pattern (interfaces in `interfaces/`, implementations in `implementations/`)
- ai_observability depends on ardoq_ai interfaces, not implementations
- New LLM clients can be added to ardoq_ai without affecting ai_observability

### 3. API Integration Points

**External Dependencies in ai_observability:**
- `deepeval` - Evaluation metrics library (behind IContextMetricEvaluator, etc.)
- `litellm` - LLM gateway (behind ILLMClient from ardoq_ai)
- `FastAPI` - Web framework (at api/ layer only)
- `aiohttp` - HTTP client (in ardoq_ai for Ardoq API calls)

**SOLID Isolation:**
- Framework dependencies live in `implementations/`, never in domain or orchestrators
- Changing deepeval → pydantic_ai requires only implementation changes
- Changing litellm → openai requires only LLM client changes

---

## Known Limitations & Future Considerations

### ✓ Current Strengths
1. **DIP throughout** - All components depend on interfaces
2. **Clear SRP** - Each evaluator has one metric category
3. **ISP adoption** - Segregated interfaces for different concerns
4. **OCP in MetricRegistry** - New metrics without orchestrator changes
5. **LSP contracts** - All implementations substitutable

### ⚠️ Areas for Future Improvement

#### 1. MetricRegistry Null Checks (Minor)
**Current Pattern:**
```python
async def _execute_hallucination(self, model_name: str, record: Record) -> MetricEvalResult:
    if self.context_evaluator is None:
        raise ValueError("context_evaluator is required for hallucination metric")
    return await self.context_evaluator.calculate_hallucination(...)
```

**Issue:** Repeated None checks for each metric

**Future Improvement:** Use Optional types more consistently in registry or validate during initialization:
```python
def __init__(self, context_evaluator: IContextMetricEvaluator):  # Required, not optional
    # Guarantees context_evaluator is never None
    self.context_evaluator = context_evaluator
```

**Benefit:** Eliminates repeated validation

#### 2. MetricHandler Validation (Minor)
**Current:** Validation in MetricHandler.validate() method

**Future:** Could use Pydantic validators or a validation DSL for cleaner required_fields checking

#### 3. Error Handling Granularity (Minor)
**Current:**
```python
async_results = await asyncio.gather(*[task[1] for task in tasks], return_exceptions=True)

# Returns -1.0 score for any exception
results.append(self._create_error_metric_result(metric_name, result_or_exception))
```

**Future:** Distinguish between:
- Data validation errors (missing context)
- LLM errors (timeout, quota exceeded)
- Metric computation errors (unexpected)
- Logging/monitoring each separately

---

## Design Patterns Used

### 1. **Dependency Injection Pattern**
- **Where:** `src/config/dependency_injection/`
- **Purpose:** Centralize component creation and wiring
- **SOLID Alignment:** Enables DIP by centralizing interface-to-implementation mapping
- **Example:** FastAPI Depends() automatically injects configured orchestrator

### 2. **Registry Pattern**
- **Where:** `src/implementations/metrics/metric_registry.py`
- **Purpose:** Dynamic metric routing and handler management
- **SOLID Alignment:** Enables OCP - register new metrics without modifying orchestrator
- **Example:** New metric registration without changing eval_orchestrator.py

### 3. **Adapter/Wrapper Pattern**
- **Where:** `base_deepeval_metric_evaluator.py`
- **Purpose:** Adapt deepeval API to domain model (Record → LLMTestCase)
- **SOLID Alignment:** Isolates framework coupling in one place
- **Example:** _create_single_turn_case_and_measure() wraps deepeval logic

### 4. **Strategy Pattern**
- **Where:** Segregated evaluator interfaces
- **Purpose:** Swap evaluation strategies (context vs. tool vs. answer)
- **SOLID Alignment:** Enables LSP - any strategy can substitute another
- **Example:** Different IContextMetricEvaluator implementations with same interface

### 5. **Factory Pattern**
- **Where:** `src/config/dependency_injection/`
- **Purpose:** Create and configure complex objects
- **SOLID Alignment:** Centralizes DIP - only factory knows about concrete classes
- **Example:** get_eval_orchestrator() factory

### 6. **Template Method Pattern**
- **Where:** `base_deepeval_metric_evaluator.py`
- **Purpose:** Define metric evaluation template, let subclasses fill specific metrics
- **SOLID Alignment:** Reduces duplication, enforces consistent behavior
- **Example:** _create_single_turn_case_and_measure() template used by all context metrics

---

## Lessons Learned from Architecture

### ✓ What Worked Well

1. **Segregated Interfaces were Key**
   - Initially considered one monolithic IEvaluator
   - Breaking into IContext, ITool, IAnswer made code much clearer
   - Adding new metric category (ICustom) was trivial

2. **MetricRegistry Solved Extensibility**
   - Without it: orchestrator would need new if-statement per metric
   - With it: register and go, orchestrator never changes
   - Enables non-engineers to add metrics (JSON config future state)

3. **Pure Domain Models Pay Off**
   - Record, Metric, EvalResult have no framework dependencies
   - Can be used in tests, CLI, alternative backends without pulling dependencies
   - Clear business logic independent from infrastructure

4. **DI at API Boundary**
   - All injection happens in one place: dependency_injection/
   - Rest of code doesn't know about FastAPI, deepeval, litellm
   - Made testing incredibly easy

### ⚠️ What Required Adjustment

1. **Evaluator Implementations Needed Base Class**
   - Different metrics share deepeval logic (creating test cases, handling models)
   - Created `BaseDeepEvalMetricEvaluator` to avoid duplication
   - Means ContextMetricEvaluator extends both IContextMetricEvaluator AND BaseDeepEvalMetricEvaluator
   - Minor complication: multiple inheritance

2. **MetricRegistry Methods Are Repetitive**
   - Each metric registration follows pattern: if evaluator exists, register handler
   - Could extract to builder or declarative configuration
   - Not critical, but could be cleaner

3. **Type Hints Required for Good DIP**
   - Without precise type hints (IContextMetricEvaluator not just "evaluator"), benefits of DIP unclear
   - Python's dynamic typing doesn't catch as many errors as stricter languages
   - Solution: Strict mypy configuration helps

---

## How SOLID Enables Key Features

### Feature: Add New Evaluation Backend

**Without SOLID:** Coupling everywhere, risky migration
**With SOLID:** Create new implementation files, update DI factory

```python
# New backend support (no existing code changes)
class PydanticAIContextMetricEvaluator(IContextMetricEvaluator):
    pass

# One line change in DI factory
def get_eval_orchestrator() -> IEvalOrchestrator:
    evaluator = get_pydantic_ai_metric_evaluator()  # Changed from get_litellm_metric_evaluator()
    return EvaluationOrchestrator(...)
```

### Feature: Unit Test Without LLM

**Without SOLID:** Need to mock at deepeval level, complex
**With SOLID:** Create MockContextMetricEvaluator implementing IContextMetricEvaluator

```python
class MockContextMetricEvaluator(IContextMetricEvaluator):
    async def calculate_hallucination(...) -> MetricEvalResult:
        return MetricEvalResult(metric=Metric.HALLUCINATION, result=EvalResult(score=0.95, ...))

# Pass to orchestrator in test
orchestrator = EvaluationOrchestrator(
    answer_evaluator=MockAnswerMetricEvaluator(),
    context_evaluator=MockContextMetricEvaluator(),  # Not real
    tool_evaluator=MockToolMetricEvaluator(),
)
```

### Feature: Add New Metric

**Without SOLID:** Orchestrator needs new if-statement, evaluator interface changes, implementation changes
**With SOLID:** Register in MetricRegistry, done

```python
# New metric (5 files modified, no existing code broken)
1. Metric enum += BIAS_DETECTION
2. ICustomMetricEvaluator += calculate_bias_detection()
3. CustomMetricEvaluator.calculate_bias_detection()
4. MetricRegistry.register_metric() + executor
5. Metric.py domain enum updated

# Orchestrator? No changes
# Routes? No changes
# Tests? Only if testing new metric
```

### Feature: Independent Schema Evolution

**Without SOLID:** Record changes affect all evaluators
**With SOLID:** Add Record field, only relevant evaluators affected

```python
# Hypothetical: Add "source" field to Record
class Record(BaseModel):
    input: str
    actual_output: str | None = None
    source: str | None = None  # NEW

# Affects only evaluators that use it
# Others unaffected - loose coupling via interfaces
```

---

## Comparison to Alternative Architectures

### Monolithic Evaluator (❌ Rejected)
```python
class Evaluator:
    def eval_context_metrics(self, ...): ...
    def eval_tool_metrics(self, ...): ...
    def eval_answer_metrics(self, ...): ...
```
**Issues:** SRP violation, ISP violation, hard to extend

### Direct Deepeval in Routes (❌ Rejected)
```python
@router.post("/eval")
async def eval(req):
    metric = HallucinationMetric()
    return await metric.a_measure(...)
```
**Issues:** DIP violation, untestable, framework coupling

### Plugins/Dynamic Loading (⚠️ Considered, Rejected)
```python
# Evaluate Python code from string
evaluator = eval(f"from evaluators.{metric} import {metric}")
```
**Issues:** Security risk, type safety lost, unclear dependencies

### Current SOLID Approach (✅ Chosen)
- Clear, testable, extensible
- Type-safe
- SOLID principles enforced by structure

---

## Recommendations for New Features

### 1. Custom Evaluators (Use ICustomMetricEvaluator)
- Implement via custom metric evaluator interface
- Register in MetricRegistry
- No orchestrator changes

### 2. New Backend (Use DIP)
- Create new implementations for interfaces
- Update DI factory
- No route/orchestrator changes

### 3. Streaming Results (Extend Interfaces Carefully)
- Add async generator support to orchestrator interface
- Preserve backwards compatibility
- Test both streaming and non-streaming paths

### 4. Metrics as Configuration (Extend OCP)
- Keep MetricRegistry registration data-driven
- Move handlers to declarative config
- Example: metrics.yml with metric definitions, handlers, validators

### 5. Performance: Metric Caching (Add New Component)
- Implement `IMetricCache` interface
- Inject into evaluators
- No evaluation logic changes
