# Decision: Remove Excessive Abstraction Layers

## Context
The AI backend codebase (ai_observability and ardoq_ai) was initially built following SOLID principles with multiple layers of abstraction. The development team found the level of abstraction too complex for practical development needs.

## Decision Made
Remove excessive abstraction layers while preserving valuable separations of concern:

**Remove:**
1. All controller interfaces and dependency injection system
2. ILLMClient interface (ardoq_ai)
3. IArdoqAPIClient interface (ardoq_ai)

**Keep:**
1. All metric & criteria evaluator interfaces (valuable domain abstractions)
2. Dataset repository interface (Confident AI integration point)
3. All concrete implementations and business logic

**Additional Changes:**
1. Rename `implementations` → `services` in ardoq_ai for clarity
2. Replace dependency injection with direct instantiation in FastAPI lifespan
3. Update routers to use `request.app.state` for service access
4. Update local_eval scripts to use helper functions from init.py

## Problem Solved
- Reduced cognitive overhead for developers
- Simplified codebase navigation and understanding
- Eliminated unnecessary indirection without losing important architectural boundaries
- Maintained testability and separation where it matters (metrics/criteria evaluation, external integrations)

## Applicability
This approach applies to:
- FastAPI-based microservices where DI framework overhead exceeds benefits
- Small-to-medium teams where explicit instantiation is clearer than implicit injection
- Projects where some abstractions provide value (domain boundaries) but others add complexity without benefit
