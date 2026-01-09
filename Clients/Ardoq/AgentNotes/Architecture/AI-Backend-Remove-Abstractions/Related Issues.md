# Related Issues and Dependencies

## Related Architecture Decisions

### Metric Evaluator Abstraction (Preserved)
- **Location:** `ai_observability/src/interfaces/evaluators/`
- **Status:** Intentionally preserved
- **Reason:** Multiple implementations, real polymorphism, domain value
- **Impact:** MetricRegistry depends on these interfaces
- **See:** Implementation.md for details on evaluator patterns

### Dataset Repository Abstraction (Preserved)
- **Location:** `ai_observability/src/interfaces/repositories/`
- **Status:** Intentionally preserved
- **Reason:** External integration boundary (Confident AI)
- **Impact:** Used by local_eval scripts and will be used by API endpoints
- **See:** Implementation.md for repository pattern

### FastAPI Dependency Injection Pattern
- **Previous:** Used FastAPI's Depends() with factory functions
- **Current:** Direct app.state access in routers
- **Reason:** Simpler for single implementations, no swapping needed
- **See:** Implementation.md for router patterns

## Related Features

### Local Evaluation Scripts
- **Files:** `ai_observability/local_eval/*.py`
- **Change:** Now use helper functions from init.py instead of DI
- **Status:** Updated and working
- **See:** Implementation.md for local script patterns

### API Routers
- **Files:** `ai_observability/src/api/routers/*.py`
- **Change:** Use request.app.state instead of Depends()
- **Status:** Updated and tested (11/11 tests passing)
- **See:** Implementation.md for router patterns

### Confident AI Integration
- **Files:** `ai_observability/src/api/routers/confident/`
- **Change:** Updated to use request.app.state for LLM client
- **Status:** Updated
- **Impact:** External API contract unchanged

## Related Bugs

### None Identified
All refactoring completed with tests passing. No regressions introduced.

## Future Considerations

### If Polymorphism Becomes Needed
**Controllers:**
- Current pattern allows adding interfaces later if needed
- Simply create interface, make controller implement it, continue using concrete type everywhere
- Only switch to interface if multiple implementations emerge

**Clients:**
- Same approach: add interface only when second implementation appears
- LLMClient already provides base class pattern for shared behavior
- ArdoqAPIClient can be retrofitted with interface if needed

### Performance Implications
**Before:** Factory function call on each dependency injection
**After:** Single instantiation in lifespan, reference from app.state
**Impact:** Marginal performance improvement (nanoseconds per request)

### Testing Strategy
**Current:** Direct instantiation of concrete classes in tests
**Future:** If mocking becomes complex, consider test fixtures or factory helpers
**Note:** No issues identified so far with current approach

## Dependencies on This Decision

### Code That Depends on Controllers
1. **API Routers** - Now access via app.state
2. **Local Scripts** - Use helper functions from init.py
3. **Lifespan** - Directly instantiates controllers

### Code That Depends on Clients
1. **Controllers** - Import concrete types
2. **Evaluators** - Import concrete LLMClient types
3. **Lifespan** - Directly instantiates clients
4. **Local Scripts** - Use helper functions

### Code That Still Uses Interfaces
1. **Metric Evaluators** - Properly abstracted domain layer
2. **Dataset Repository** - External integration boundary
3. **Generic Evaluator** - Uses IGenericEvaluator interface

## Migration Path for Similar Projects

1. **Identify** interfaces with 1:1 implementation ratios
2. **Preserve** interfaces with real polymorphism or domain value
3. **Remove** factory functions and DI configuration
4. **Update** lifespan to direct instantiation
5. **Modify** routers to use request.app.state
6. **Verify** tests still pass
7. **Update** documentation

## Rollback Plan (If Needed)

**To restore abstractions:**
1. Recreate interface files (preserved in git history)
2. Restore `src/config/dependency_injection/` directory
3. Restore `src/api/config/dependencies.py`
4. Revert router changes to use Depends()
5. Revert lifespan to use factory functions
6. Revert local scripts to use DI imports

**Effort:** ~2-4 hours
**Risk:** Low (all changes tracked in git)
