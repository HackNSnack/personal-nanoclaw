# Architecture Decision: SOLID-Driven LLM Evaluation Framework

## What Was Decided

The `ai_observability` and `libs/ardoq_ai` projects implement a **segregated interface-based architecture** grounded in SOLID principles, with particular emphasis on:

1. **Dependency Inversion Principle (DIP)** - All components depend on abstractions (interfaces), not concrete implementations
2. **Interface Segregation Principle (ISP)** - Specialized interfaces for domain-specific evaluators (context, tool, answer, custom)
3. **Single Responsibility Principle (SRP)** - Each evaluator type handles one category of metric evaluation
4. **Open/Closed Principle (OCP)** - New metrics and evaluators can be added without modifying existing code
5. **Liskov Substitution Principle (LSP)** - Implementations are fully substitutable for their interfaces

## Problem Solved

Before this architecture:
- Framework coupling: Direct deepeval/litellm dependencies throughout codebase
- Difficult testing: Hard to mock evaluation backends
- Limited extensibility: Adding new metrics required changes in multiple layers
- Tight coupling: Routers directly calling evaluators without orchestration
- Maintenance burden: Backend library changes ripple through entire system

This architecture provides:
- **Testability**: Mock any interface for unit tests
- **Extensibility**: Add metrics without modifying existing code (via MetricRegistry)
- **Backend flexibility**: Swap evaluation libraries (deepeval → Pydantic AI) by replacing implementations
- **Clear separation**: HTTP/API layer independent from evaluation business logic
- **Predictable growth**: New features follow established patterns

## Scope & Applicability

**Applies to:**
- `projects/ai_observability/src/` - Evaluation API and orchestration
- `libs/ardoq_ai/` - Shared domain models and interfaces
- Any future evaluation or LLM client implementations

**Specifically follows SOLID in:**
- Evaluator hierarchy (IContextMetricEvaluator, IToolMetricEvaluator, etc.)
- Orchestrator pattern (EvaluationOrchestrator uses MetricRegistry)
- Dependency injection configuration
- Domain model design (Record, Metric, EvalResult)
