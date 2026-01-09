# Snippet 004 - Updated Plan (Metric Evaluators Excluded)

## User Clarification
User requested to leave ALL metric evaluator abstractions untouched. They are valuable and should remain as-is.

## Revised Abstraction Removal Plan

## Phase 1: Remove Controller Abstractions (ai_observability)

### Step 1.1: Replace Controller Interfaces with Direct Implementations
**Remove:**
- `src/interfaces/controllers/i_metric_eval_controller.py`
- `src/interfaces/controllers/i_criteria_eval_controller.py`
- `src/interfaces/controllers/i_metric_completion_eval_controller.py`

**Update:**
- `src/implementations/controllers/metric_eval_controller.py` - Remove ABC inheritance
- `src/implementations/controllers/gremlin_eval_controller.py` - Remove ABC inheritance
- `src/implementations/controllers/metric_completion_eval_controller.py` - Remove ABC inheritance

### Step 1.2: Remove Dependency Injection System
**Remove:**
- `src/config/dependency_injection/__init__.py`
- `src/config/dependency_injection/controllers/__init__.py`
- `src/config/dependency_injection/evaluators/__init__.py` (if only used for DI)
- `src/config/dependency_injection/completion/__init__.py`
- `src/config/dependency_injection/repositories/__init__.py` (if only used for DI)

**Update:**
- `src/api/config/dependencies.py` - Simplify to direct instantiation
- `src/api/config/lifespan.py` - Remove controller setup from app.state
- All routers - Import and instantiate controllers directly

### Step 1.3: Simplify Router Dependencies
**Update:**
- `src/api/routers/simple_router.py` - Remove dependency injection, instantiate directly
- `src/api/routers/completion_router.py` - Remove dependency injection, instantiate directly
- `src/api/routers/gremlin_router.py` - Remove dependency injection, instantiate directly

## Phase 2: Remove LLM Client Abstraction (ardoq_ai)

### Step 2.1: Remove ILLMClient Interface
**Remove:**
- `ardoq_ai/interfaces/completion/generic/i_llm_client.py`
- `ardoq_ai/interfaces/completion/__init__.py` (if empty)
- `ardoq_ai/interfaces/completion/generic/__init__.py` (if empty)

**Update:**
- `ardoq_ai/implementations/completion/generic/llm_client.py` - Remove ABC inheritance
- `ardoq_ai/implementations/completion/generic/litellm_client.py` - Direct concrete class

### Step 2.2: Update Consumers in ai_observability
**Update:**
- `src/implementations/evaluators/generic_evaluator.py` - Use `LiteLLMClient` directly
- `src/implementations/controllers/metric_completion_eval_controller.py` - Use `LiteLLMClient` directly
- Any other files importing `ILLMClient`

## Phase 3: Remove Ardoq API Client Abstraction (ardoq_ai)

### Step 3.1: Remove IArdoqAPIClient Interface
**Remove:**
- `ardoq_ai/interfaces/clients/ardoq/i_ardoq_api_client.py`
- `ardoq_ai/interfaces/clients/ardoq/__init__.py` (if empty)
- `ardoq_ai/interfaces/clients/__init__.py` (if empty)

**Update:**
- `ardoq_ai/implementations/clients/ardoq/ardoq_api_client.py` - Remove ABC inheritance
- `src/implementations/controllers/gremlin_eval_controller.py` - Use `ArdoqAPIClient` directly

## Phase 4: Keep All Evaluator Abstractions (ai_observability)

### NO CHANGES - LEAVE AS-IS
**KEEP ALL:**
- `IAnswerMetricEvaluator`
- `IContextMetricEvaluator`
- `IToolMetricEvaluator`
- `ICustomMetricEvaluator`
- `IGenericEvaluator`
- `IHallucinationEvaluator`
- `IFaithfulnessEvaluator`
- `IContextualPrecisionEvaluator`
- `IContextualRecallEvaluator`
- `IContextualRelevancyEvaluator`

**KEEP ALL Implementations:**
- All evaluator implementations remain unchanged

## Phase 5: Keep Repository Abstractions (ai_observability)

### NO CHANGES - LEAVE AS-IS
**KEEP:**
- `IDatasetRepository` interface
- `ConfidentAIDatasetRepository` implementation

## Phase 6: Update Imports and Clean Up

### Step 6.1: Update Import Statements for Removed Interfaces
- Controller interfaces → concrete implementations
- `ILLMClient` → `LiteLLMClient`
- `IArdoqAPIClient` → `ArdoqAPIClient`

### Step 6.2: Remove Empty Interface Directories
- Only clean up directories related to removed interfaces
- DO NOT touch evaluator or repository interface directories

### Step 6.3: Update Tests
- Update tests for controllers to use concrete classes
- Update tests for LLM client and Ardoq client
- DO NOT modify evaluator tests

## Summary of What Gets Removed

**ai_observability:**
1. ✅ All controller interfaces and DI system
2. ❌ NO evaluator changes (all stay)

**ardoq_ai:**
1. ✅ `ILLMClient` interface
2. ✅ `IArdoqAPIClient` interface

## Summary of What Stays (Unchanged)

**ai_observability:**
1. ✅ ALL evaluator interfaces (no changes whatsoever)
2. ✅ `IDatasetRepository` interface (Confident AI integration)
3. ✅ All implementations
4. ✅ MetricRegistry and MetricHandler

**ardoq_ai:**
1. ✅ Concrete implementations (LiteLLMClient, ArdoqAPIClient) - just remove ABC
2. ✅ Domain models
3. ✅ All concrete functionality

## Benefits
1. Reduced controller complexity - direct instantiation
2. Simpler LLM/API client usage - concrete classes
3. Preserved metric evaluation architecture - untouched
4. Preserved Confident AI integration - untouched
5. Less boilerplate for routing/orchestration layer
