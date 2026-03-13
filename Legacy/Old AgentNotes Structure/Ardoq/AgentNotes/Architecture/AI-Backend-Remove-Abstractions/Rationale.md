# Rationale: Why Remove These Abstractions

## Why Remove Controller Abstractions?

### Problem
- Three controller interfaces (IMetricEvalController, ICriteriaEvalController, IMetricCompletionEvalController)
- Complex dependency injection setup with factory functions
- Single implementation per interface (no polymorphism benefit)
- Additional cognitive load for new developers

### Solution
- Direct concrete class usage
- Instantiation in FastAPI lifespan
- Access via `request.app.state`
- Controllers still exist as concrete classes with clear responsibilities

### Trade-offs
**Lost:**
- Ability to swap implementations via DI (not needed - single implementation)
- Abstract interface documentation (moved to concrete class docs)

**Gained:**
- Clearer code flow (explicit instantiation visible in lifespan.py)
- Faster onboarding (fewer concepts to learn)
- Less boilerplate (no factory functions, no DI configuration)

## Why Remove Client Abstractions?

### Problem
- ILLMClient and IArdoqAPIClient interfaces with single implementations
- No actual need for polymorphism in practice
- Import complexity (interfaces vs implementations)

### Solution
- Direct use of LiteLLMClient and ArdoqAPIClient
- Still abstract base LLMClient class for shared behavior
- Clear concrete types in function signatures

### Trade-offs
**Lost:**
- Theoretical ability to swap client implementations (never needed in practice)
- Interface-based mocking in tests (can mock concrete classes just as easily)

**Gained:**
- Simpler import structure
- Clearer type hints (concrete types)
- Reduced file count

## Why Keep Evaluator Abstractions?

### Value Preserved
- Multiple implementations per interface (LiteLLMMetricEvaluator with multiple inheritance)
- Clear domain boundaries (answer vs context vs tool evaluation)
- MetricRegistry depends on these interfaces for handler dispatch
- Real polymorphism in use (different evaluators for different metrics)

### Why This Is Different
Controllers and clients had 1:1 interface:implementation ratios. Evaluators have actual polymorphic behavior and domain value.

## Why Keep Dataset Repository Abstraction?

### Value Preserved
- Integration point with external system (Confident AI)
- May need multiple implementations (mock for testing, different providers)
- Clear boundary between application and external data source

## Alternatives Considered

### Alternative 1: Remove All Abstractions
**Rejected:** Evaluator abstractions provide real value via polymorphism and domain modeling.

### Alternative 2: Keep All Abstractions
**Rejected:** Team feedback indicated current complexity was hindering development velocity.

### Alternative 3: Use Full DI Framework (e.g., dependency-injector)
**Rejected:** Adds external dependency and learning curve without clear benefit for this codebase size.

## Long-term Implications

### Positive
- Easier to understand and modify
- Faster feature development
- Lower maintenance burden
- Clearer architectural intent (abstractions where needed, concrete where not)

### Risks Mitigated
- If polymorphism becomes needed for controllers/clients, we can add interfaces at that time
- Current concrete classes already encapsulate behavior well
- Tests remain comprehensive and maintainable
