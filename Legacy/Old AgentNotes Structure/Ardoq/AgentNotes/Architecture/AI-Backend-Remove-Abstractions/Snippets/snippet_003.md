# Snippet 003 - Abstraction Removal Plan

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
- `src/config/dependency_injection/evaluators/__init__.py`
- `src/config/dependency_injection/completion/__init__.py`
- `src/config/dependency_injection/repositories/__init__.py`

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
- `ardoq_ai/interfaces/completion/__init__.py`

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

**Update:**
- `ardoq_ai/implementations/clients/ardoq/ardoq_api_client.py` - Remove ABC inheritance
- `src/implementations/controllers/gremlin_eval_controller.py` - Use `ArdoqAPIClient` directly

## Phase 4: Consolidate Evaluator Interfaces (ai_observability)

### Step 4.1: Keep Core Metric/Criteria Abstractions
**KEEP (these are valuable abstractions):**
- `IAnswerMetricEvaluator`
- `IContextMetricEvaluator`
- `IToolMetricEvaluator`
- `ICustomMetricEvaluator`
- `IGenericEvaluator`

**REMOVE (too granular):**
- `i_hallucination_evaluator.py`
- `i_faithfulness_evaluator.py`
- `i_contextual_precision_evaluator.py`
- `i_contextual_recall_evaluator.py`
- `i_contextual_relevancy_evaluator.py`

### Step 4.2: Simplify Evaluator Implementations
**Update:**
- Keep `LiteLLMMetricEvaluator` with multiple inheritance (this is the implementation pattern)
- Keep base evaluators (`AnswerMetricEvaluator`, `ContextMetricEvaluator`, etc.)

## Phase 5: Keep Repository Abstractions (ai_observability)

### No Changes Needed
**KEEP (Confident AI integration):**
- `IDatasetRepository` interface
- `ConfidentAIDatasetRepository` implementation

## Phase 6: Update Imports and Clean Up

### Step 6.1: Update All Import Statements
- Find all files importing removed interfaces
- Replace with concrete implementations
- Update type hints

### Step 6.2: Remove Empty Interface Directories
- Clean up empty `interfaces/` subdirectories
- Update `__init__.py` files

### Step 6.3: Update Tests
- Update test files to use concrete implementations
- Remove mocks for removed interfaces

## Summary of What Gets Removed

**ai_observability:**
1. All controller interfaces and DI system
2. Granular evaluator interfaces (hallucination, faithfulness, etc.)
3. Dependency injection infrastructure

**ardoq_ai:**
1. `ILLMClient` interface
2. `IArdoqAPIClient` interface

## Summary of What Stays

**ai_observability:**
1. Core evaluator interfaces (Answer, Context, Tool, Custom, Generic)
2. `IDatasetRepository` interface (Confident AI integration)
3. All implementations
4. MetricRegistry and MetricHandler

**ardoq_ai:**
1. Concrete implementations (LiteLLMClient, ArdoqAPIClient)
2. Domain models
3. All concrete functionality

## Benefits
1. Reduced complexity - fewer layers of indirection
2. Easier to navigate - direct imports of concrete classes
3. Less boilerplate - no factory functions or DI setup
4. Still maintains separation where it matters (metrics/criteria evaluation, Confident AI)
5. Faster development - less ceremony for adding features
