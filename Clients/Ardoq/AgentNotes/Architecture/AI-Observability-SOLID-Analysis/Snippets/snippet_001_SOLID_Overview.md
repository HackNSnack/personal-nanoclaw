# SOLID Architecture Overview - Snippets

## Quick Reference: SOLID Principles Applied

### 1. Dependency Inversion Principle (DIP) ✓
**Rule:** Depend on abstractions, not concrete implementations

```
┌─────────────────────────────────────────────────────────────┐
│ HTTP Route (simple_router.py)                               │
│ Depends on: IEvalOrchestrator (interface)                   │
└────────────────────────┬────────────────────────────────────┘
                         │ FastAPI injects
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Orchestrator Factory (dependency_injection/)                │
│ Creates: EvaluationOrchestrator                             │
│ Returns: Typed as IEvalOrchestrator                         │
└────────────────────────┬────────────────────────────────────┘
                         │ Instantiates
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ EvaluationOrchestrator (implementations/)                   │
│ Depends on: IContextMetricEvaluator, IToolMetricEvaluator   │
└─────────────────────────────────────────────────────────────┘
```

**Result:** Routes never know about deepeval, litellm, or specific implementations

---

### 2. Interface Segregation Principle (ISP) ✓
**Rule:** Clients depend only on interfaces they use

```
Instead of one fat IEvaluator:
┌──────────────────────────────────────┐
│ IEvaluator (10+ methods)             │
│ ├─ calculate_hallucination()         │
│ ├─ calculate_faithfulness()          │
│ ├─ calculate_tool_correctness()      │ ← Unused by this impl
│ ├─ calculate_custom_metric()         │ ← Unused by this impl
│ └─ ... 6 more                        │
└──────────────────────────────────────┘

We use segregated interfaces:
┌─────────────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ IContextMetricEvaluator │  │ IToolMetricEval  │  │ IAnswerMetricEval│
│ ├─ hallucination()      │  │ ├─ tool_correct()│  │ ├─ answer_relev()│
│ ├─ faithfulness()       │  │ └─ (1 method)    │  │ └─ (1 method)    │
│ ├─ precision()          │  └──────────────────┘  └──────────────────┘
│ ├─ recall()             │
│ └─ relevancy()          │
└─────────────────────────┘

Result: No fat interfaces, minimal implementations
```

---

### 3. Single Responsibility Principle (SRP) ✓
**Rule:** Each class has one reason to change

```
┌─────────────────────────────────────────────────────────────┐
│ Component                                                   │
├─────────────────────────────────────────────────────────────┤
│ ContextMetricEvaluator  → Changes if: deepeval API changes  │
│ ToolMetricEvaluator     → Changes if: tool eval logic       │
│ AnswerMetricEvaluator   → Changes if: answer eval logic     │
│ EvaluationOrchestrator  → Changes if: parallelization       │
│ MetricRegistry          → Changes if: routing logic         │
│ Record (domain model)   → Changes if: evaluation input      │
│ Metric (enum)           → Changes if: available metrics    │
└─────────────────────────────────────────────────────────────┘

Result: Localized changes, low coupling
```

---

### 4. Open/Closed Principle (OCP) ✓
**Rule:** Open for extension, closed for modification

```
Adding new metric: BIAS_DETECTION

Steps:
1. Add to Metric enum                    ← Metric.py
2. Add to interface                      ← i_custom_metric_evaluator.py
3. Implement method                      ← custom_metric_evaluator.py
4. Register in MetricRegistry            ← metric_registry.py

Result: ✓ EvaluationOrchestrator unchanged
        ✓ Routes unchanged
        ✓ Factories unchanged
        ✓ Other evaluators unchanged

OCP: ✓ Open for new metrics
      ✓ Closed for existing code modification
```

---

### 5. Liskov Substitution Principle (LSP) ✓
**Rule:** Subtypes must be substitutable for base types

```
Any IContextMetricEvaluator can be substituted:

┌──────────────────────────────────────────┐
│ ContextMetricEvaluator (deepeval)        │
│ ├─ calculate_hallucination() → (0.95)    │
│ ├─ calculate_faithfulness() → (0.88)     │
│ └─ ... all context metrics               │
└──────────────────────────────────────────┘
                    │
                    ↕ Substitutable
                    │
┌──────────────────────────────────────────┐
│ PydanticAIContextMetricEvaluator (future) │
│ ├─ calculate_hallucination() → (0.95)    │
│ ├─ calculate_faithfulness() → (0.88)     │
│ └─ ... all context metrics               │
└──────────────────────────────────────────┘
                    │
                    ↕ Substitutable
                    │
┌──────────────────────────────────────────┐
│ MockContextMetricEvaluator (test)        │
│ ├─ calculate_hallucination() → (0.95)    │
│ ├─ calculate_faithfulness() → (0.88)     │
│ └─ ... all context metrics               │
└──────────────────────────────────────────┘

Result: Test without LLM, swap backends easily
```

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│ API Layer (simple_router.py)                                │
│ Depends on: IEvalOrchestrator                               │
└───────────────┬─────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────┐
│ Orchestration Layer (eval_orchestrator.py)                  │
│ Depends on: IContextMetricEvaluator, IToolMetricEvaluator   │
│ Uses: MetricRegistry for metric routing                     │
└───────────────┬─────────────────────────────────────────────┘
                │
    ┌───────────┼───────────┬──────────────┐
    │           │           │              │
┌───▼───────┐ ┌─▼────────┐ ┌─▼─────────┐ ┌──▼──────────┐
│ Context   │ │ Tool     │ │ Answer    │ │ Custom      │
│ Evaluators│ │Evaluators│ │Evaluators │ │ Evaluators  │
│(IContext) │ │(ITool)   │ │(IAnswer)  │ │(ICustom)    │
└───┬───────┘ └─┬────────┘ └─┬─────────┘ └──┬──────────┘
    │           │           │              │
    └───────────┼───────────┼──────────────┘
                │
┌───────────────▼─────────────────────────────────────────────┐
│ Framework Layer (deepeval, litellm)                         │
│ Isolated in implementations/, not exposed to domain logic   │
└─────────────────────────────────────────────────────────────┘

Domain Models (Record, Metric, EvalResult) - Framework agnostic
Configuration & Dependency Injection - Wires everything
```

---

## Data Flow: Evaluation Request

```
HTTP Request: POST /eval/
  └─ MetricEvalRequest
     ├─ record: Record
     ├─ eval_model: str
     └─ metrics: [Metric]
     
  ▼ Dependency Injection
  
Orchestrator: EvaluationOrchestrator
  │
  ├─ Validate (via MetricRegistry)
  │  └─ Check if context exists for context metrics
  │
  ├─ Route metrics (via MetricRegistry.get_handler)
  │  ├─ HALLUCINATION → context_evaluator.calculate_hallucination()
  │  ├─ FAITHFULNESS → context_evaluator.calculate_faithfulness()
  │  └─ TOOL_CORRECTNESS → tool_evaluator.calculate_tool_correctness()
  │
  ├─ Execute concurrently (asyncio.gather)
  │  ├─ ContextMetricEvaluator
  │  │  └─ Convert Record → deepeval LLMTestCase
  │  │     └─ deepeval.HallucinationMetric.a_measure()
  │  ├─ ToolMetricEvaluator
  │  │  └─ Compare actual vs expected tools
  │  └─ ...
  │
  └─ Return [MetricEvalResult]
     ├─ MetricEvalResult(metric=HALLUCINATION, score=0.95, passed=True)
     ├─ MetricEvalResult(metric=FAITHFULNESS, score=0.88, passed=True)
     └─ MetricEvalResult(metric=TOOL_CORRECTNESS, score=1.0, passed=True)
     
  ▼
  
HTTP Response: MetricEvalResponse
  └─ results: [MetricEvalResult]
```

---

## Testing Strategy Enabled by SOLID

```
Without SOLID:
┌─────────────────────────────────────┐
│ Test requires: deepeval, litellm    │
│ Real LLM calls, slow & flaky        │
│ Hard to mock framework dependencies │
└─────────────────────────────────────┘

With SOLID:
┌────────────────────────────────────────┐
│ Create: MockContextMetricEvaluator      │
│ Implements: IContextMetricEvaluator     │
│ No LLM calls, deterministic, fast       │
│ Inject into EvaluationOrchestrator      │
└────────────────────────────────────────┘

Result: Unit tests run in milliseconds
        No external dependencies needed
        Deterministic, reliable CI/CD
```

---

## Key Files for Each Principle

| SOLID Principle | Key Files | Purpose |
|-----------------|-----------|---------|
| **DIP** | `interfaces/`, `dependency_injection/` | Abstractions & wiring |
| **ISP** | `interfaces/evaluators/i_*.py` | Segregated interfaces |
| **SRP** | `implementations/evaluators/*.py` | Single-responsibility classes |
| **OCP** | `metric_registry.py` | Extensible routing |
| **LSP** | All evaluator implementations | Substitutable for interfaces |
