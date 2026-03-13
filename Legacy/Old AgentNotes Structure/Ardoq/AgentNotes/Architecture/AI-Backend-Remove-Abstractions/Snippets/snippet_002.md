# Snippet 002 - Current Abstraction Layer Analysis

## ai_observability Project Structure

### Controllers Layer (TO REMOVE)
**Interfaces:**
- `IMetricEvalController` - Abstract interface for metric evaluation
- `ICriteriaEvalController` - Abstract interface for criteria evaluation  
- `IMetricCompletionEvalController` - Abstract interface for completion with metrics

**Implementations:**
- `MetricEvalController` - Orchestrates metric evaluation via evaluators
- `GremlinEvalController` - Handles Gremlin query evaluation
- `MetricCompletionEvalController` - Combines completion + metric evaluation

**Dependency Injection:**
- `src/config/dependency_injection/controllers/__init__.py` - Factory functions
- `src/api/config/dependencies.py` - FastAPI dependency injection setup
- Controllers stored in `request.app.state` and injected via `Depends()`

### Evaluators Layer (PARTIALLY KEEP)
**Interfaces (KEEP for metrics/criteria):**
- `IAnswerMetricEvaluator` - Answer relevancy evaluation
- `IContextMetricEvaluator` - Context-based metrics (hallucination, faithfulness, etc.)
- `IToolMetricEvaluator` - Tool usage evaluation
- `ICustomMetricEvaluator` - Custom metric evaluation
- `IGenericEvaluator` - Generic evaluation (KEEP - used for criteria)

**Interfaces (REMOVE - too granular):**
- `IHallucinationEvaluator`
- `IFaithfulnessEvaluator`
- `IContextualPrecisionEvaluator`
- `IContextualRecallEvaluator`
- `IContextualRelevancyEvaluator`

**Implementations:**
- `LiteLLMMetricEvaluator` - Multiple inheritance from all evaluator types
- `AnswerMetricEvaluator` - Base implementation for answer metrics
- `ContextMetricEvaluator` - Base implementation for context metrics
- `ToolMetricEvaluator` - Base implementation for tool metrics
- `CustomMetricEvaluator` - Base implementation for custom metrics
- `GenericEvaluator` - Generic evaluation implementation (KEEP)

### Repositories Layer (KEEP)
**Interfaces:**
- `IDatasetRepository` - Dataset access abstraction (KEEP - Confident AI integration)

**Implementations:**
- `ConfidentAIDatasetRepository` - Confident AI dataset integration

### Supporting Components
- `MetricRegistry` - Maps metrics to handlers
- `MetricHandler` - Executes and validates metrics

## ardoq_ai Library Structure

### Completion Layer (TO REMOVE)
**Interfaces:**
- `ILLMClient` - Abstract LLM client interface

**Implementations:**
- `LLMClient` - Base abstract implementation with pydantic_ai Agent
- `LiteLLMClient` - Concrete implementation with LiteLLM provider

### Clients Layer (TO REMOVE - discuss)
**Interfaces:**
- `IArdoqAPIClient` - Abstract Ardoq API client

**Implementations:**
- `ArdoqAPIClient` - Concrete Ardoq API client

## Usage Patterns

### Current Flow (with abstractions):
1. FastAPI router receives request
2. Router uses dependency injection to get controller interface
3. Controller interface injected from `app.state` (set up in lifespan)
4. Controller orchestrates evaluators via interfaces
5. Evaluators use LLM client via interface
6. Response returned

### Target Flow (simplified):
1. FastAPI router receives request
2. Router directly calls concrete service/function
3. Service uses concrete evaluators directly
4. Evaluators use concrete LLM client
5. Response returned
