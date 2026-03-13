# SOLID Principles Rationale

## 1. Dependency Inversion Principle (DIP) - Core Foundation

### Implementation
All components depend on interfaces, never on concrete implementations:

```
HTTP Routes → IEvalOrchestrator ← EvaluationOrchestrator
           → IContextMetricEvaluator ← ContextMetricEvaluator (deepeval-based)
           → IToolMetricEvaluator ← ToolMetricEvaluator (deepeval-based)
```

### Why Chosen
- **Decoupling**: Routes don't know about deepeval, litellm, or specific implementations
- **Testability**: Inject MockContextMetricEvaluator in tests; real implementation never called
- **Flexibility**: Swap entire evaluation backend without touching HTTP routes
- **Example**: Add `PydanticAIContextMetricEvaluator` - only DI factory changes, routes unaffected

### Trade-offs Accepted
- More files (interfaces/ + implementations/)
- Slight complexity in factory setup (dependency_injection/)
- Worth it for production flexibility

---

## 2. Interface Segregation Principle (ISP) - Specialized Contracts

### Implementation
Rather than one monolithic `IEvaluator` interface, segregated into domain-specific interfaces:

```python
# Instead of: IEvaluator with 10+ methods
# We have:
- IContextMetricEvaluator      # 5 context-based metrics
- IToolMetricEvaluator         # 1 tool metric
- IAnswerMetricEvaluator       # 1 answer metric
- ICustomMetricEvaluator       # Custom evaluation logic
```

### Why Chosen
- **No fat interfaces**: Clients depend only on the metrics they need
- **Clear responsibility**: Each interface represents one evaluation domain
- **Composition**: LiteLLMMetricEvaluator implements all three → full evaluator
- **Future extensibility**: New evaluator type? Add IXMetricEvaluator without touching existing

### Real-World Benefit
If implementing a metrics library that only does context evaluation:
```python
class MinimalContextEvaluator(IContextMetricEvaluator):
    async def calculate_hallucination(...): ...
    async def calculate_faithfulness(...): ...
    # Can ignore tool evaluation entirely - not in interface
```

---

## 3. Single Responsibility Principle (SRP) - One Reason to Change

### Implementation
Each evaluator type has one reason to change:

| Component | Responsibility | Reason to Change |
|-----------|-----------------|------------------|
| `ContextMetricEvaluator` | Context-based hallucination/faithfulness | deepeval context metric API changes |
| `ToolMetricEvaluator` | Tool invocation correctness | deepeval tool metric API changes |
| `AnswerMetricEvaluator` | Answer relevancy | deepeval answer metric API changes |
| `EvaluationOrchestrator` | Concurrent evaluation orchestration | Need to change parallelization strategy |
| `MetricRegistry` | Metric routing & validation | Need to add/remove metric categories |
| `Record` domain model | Represent evaluation input | Domain requirements change |

### Why Chosen
- **Maintainability**: Changes to deepeval API affect only one evaluator class
- **Testability**: Each class has minimal dependencies
- **Clarity**: File name → responsibility mapping

### Example: Adding Support for Custom Metrics
Instead of modifying EvaluationOrchestrator:
- Create ICustomMetricEvaluator
- Implement CustomMetricEvaluator
- Add to MetricRegistry registration
- Update orchestrator factory
Result: ✓ Existing code unchanged, new metrics workflow clear

---

## 4. Open/Closed Principle (OCP) - Extensible Without Modification

### Implementation
New metrics added via MetricRegistry without modifying orchestrator:

```python
# To add new metric, OPEN file: metric_registry.py
# CLOSE file: eval_orchestrator.py
registry.register_metric(
    MetricHandler(
        metric=Metric.MY_NEW_METRIC,
        required_fields={MetricRequirement.ACTUAL_OUTPUT, ...},
        executor=self._execute_my_new_metric,
    )
)
```

Workflow to add new metric:
1. Add to Metric enum (`src/domain/eval/metric.py`)
2. Add method to appropriate interface (e.g., `IContextMetricEvaluator`)
3. Implement in concrete class (e.g., `ContextMetricEvaluator`)
4. Register in `MetricRegistry._register_metrics()`
5. No changes to: EvaluationOrchestrator, API routers, or orchestrator factory

### Why Chosen
- **Growth**: 10 new metrics? Add them without orchestrator changes
- **Confidence**: Existing metrics never affected
- **Testability**: New metric failure isolated to new code

---

## 5. Liskov Substitution Principle (LSP) - Faithful Substitution

### Implementation
Any IContextMetricEvaluator implementation can replace another without breaking contracts:

```python
# These are substitutable:
- ContextMetricEvaluator (deepeval-based)
- PydanticAIContextMetricEvaluator (hypothetical, Pydantic AI-based)
- MockContextMetricEvaluator (for testing)

# All return same MetricEvalResult structure
# All handle Context input the same way
# All have same async signature
```

### Why Chosen
- **Backend independence**: Swap evaluation library without orchestrator knowing
- **Testing**: Mock evaluator has identical contract to real one
- **Migration**: Phase out deepeval without breaking production code

### Example: Testing Without Real LLM
```python
class MockContextMetricEvaluator(IContextMetricEvaluator):
    async def calculate_hallucination(...) -> MetricEvalResult:
        return MetricEvalResult(
            metric=Metric.HALLUCINATION,
            result=EvalResult(score=0.95, passed=True, ...)
        )

# Inject into EvaluationOrchestrator for unit tests
# Identical interface, zero LLM calls
```

---

## Alternatives Considered & Rejected

### ❌ Option: Monolithic Evaluator Interface
```python
class IEvaluator(ABC):
    # 10+ methods, all metric types mixed
    @abstractmethod
    async def calculate_hallucination(...): ...
    @abstractmethod
    async def calculate_tool_correctness(...): ...
    @abstractmethod
    async def calculate_answer_relevancy(...): ...
    # ... more
```
**Rejected because:**
- Fat interface violates ISP
- Clients depend on metrics they don't use
- Hard to implement subset of metrics

### ❌ Option: Direct Deepeval in Routes
```python
@router.post("/eval")
async def eval(req):
    metric = HallucinationMetric(model="gpt-4")
    case = LLMTestCase(...)
    score = await metric.a_measure(case)
    return response
```
**Rejected because:**
- Framework coupling
- Hard to test without real LLM
- Can't swap to new evaluation library
- Route logic mixed with evaluation logic

### ❌ Option: Factory Pattern Without DI
```python
evaluator = EvaluatorFactory.create("deepeval")
```
**Rejected because:**
- Less testable
- No automatic injection
- Configuration scattered

**Chosen:** Full DI container with interface-based architecture ✓

---

## Trade-offs & Costs

| Trade-off | Cost | Benefit | Worth It? |
|-----------|------|---------|----------|
| More files | ~30% more Python files | Clear separation, reusability | ✓ Yes |
| DI setup | ~50 LOC in factories | Easy testing, swappable backends | ✓ Yes |
| Interface definitions | ~20% more code | Decoupling, extensibility | ✓ Yes |
| MetricRegistry complexity | ~100 LOC | Flexible metric routing | ✓ Yes |

**Conclusion:** Upfront SOLID cost (~200 lines, 35 files) → massive production gain (testable, extensible, maintainable)
