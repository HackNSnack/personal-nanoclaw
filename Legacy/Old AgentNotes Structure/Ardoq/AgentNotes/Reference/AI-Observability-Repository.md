# AI Observability Repository - Structure & Architecture

## Repository Overview

**Location**: `projects/ai_observability/`  
**Purpose**: LLM evaluation API for assessing LLM outputs against pre-defined and custom criteria  
**Framework**: FastAPI with async/await pattern  
**Design Philosophy**: Interface-based abstraction following SOLID principles (especially Dependency Inversion Principle)

## High-Level Architecture

The repository follows a layered architecture with clear separation of concerns:

```
API Layer (FastAPI) → Controllers → MetricRegistry → Evaluators → External Libraries (deepeval)
         ↓                                ↓
    Domain Models                    Interfaces (ABC)
```

## Directory Structure & Responsibilities

### `/src/api/` - HTTP Application Layer

**Purpose**: FastAPI application configuration, routing, and HTTP-specific logic

#### `/src/api/app.py`
- **Responsibility**: Main FastAPI application instance
- **Key Features**:
  - Defines app with lifespan management
  - Registers middleware (host whitelist, Ardoq context)
  - Includes routers for different endpoints
  - Health check endpoint

#### `/src/api/routers/`
- **Responsibility**: HTTP endpoint handlers
- **Files**:
  - `simple_router.py` - `/eval/` endpoint for evaluation without completion
  - `completion_router.py` - Evaluation with LLM completion
  - `gremlin_router.py` - Gremlin-specific evaluation
  - `confident/confident_router.py` - Confident AI framework integration

**Pattern**: Routers are thin layers that:
1. Parse incoming requests
2. Inject controllers via `request.app.state`
3. Call controller methods
4. Return responses

#### `/src/api/domain/`
- **Responsibility**: API request/response models (Pydantic)
- **Structure**:
  - `requests/` - Input models (`MetricEvalRequest`, `CompletionRequest`, etc.)
  - `responses/` - Output models (`MetricEvalResponse`, `CompletionResponse`, etc.)

#### `/src/api/config/`
- **Responsibility**: Application lifecycle and middleware configuration
- **Files**:
  - `lifespan.py` - App startup/shutdown, dependency injection initialization
  - `headers.py` - Header processing
  - `middleware/host_whitelist.py` - Host validation
  - `middleware/set_ardoq_context.py` - Ardoq context management

---

### `/src/domain/` - Core Domain Models

**Purpose**: Framework-agnostic domain models representing core business concepts

#### `/src/domain/data/`
- `record.py` - **Record**: Single evaluation unit with input, output, context, tools
- `dataset.py` - **Dataset**: Collection of records for batch evaluation

#### `/src/domain/eval/`
- `metric.py` - **Metric**: Enum of available metrics (StrEnum)
- `result.py` - **EvalResult**: Evaluation outcome (score, passed, reasoning, threshold)
- `output.py` - **MetricEvalResult**: Combines metric name with EvalResult

**Key Principle**: Domain models have NO dependencies on external frameworks (deepeval, OpenAI, etc.)

---

### `/src/interfaces/` - Abstract Contracts

**Purpose**: Python ABC interfaces defining contracts for implementations

#### `/src/interfaces/evaluators/`
Segregated interfaces by domain:

- `i_answer_metric_evaluator.py` - Answer relevancy evaluation
- `i_context_metric_evaluator.py` - Context-based metrics (hallucination, faithfulness, etc.)
- `i_tool_metric_evaluator.py` - Tool invocation correctness
- `i_custom_metric_evaluator.py` - Custom evaluation logic
- Legacy interfaces (single-metric): `i_hallucination_evaluator.py`, `i_faithfulness_evaluator.py`, etc.

**Interface Segregation Pattern**: Each interface contains only related methods, allowing clients to depend on minimal contracts.

#### `/src/interfaces/repositories/`
- `i_dataset_repository.py` - Data access abstraction

---

### `/src/implementations/` - Concrete Implementations

**Purpose**: Business logic implementing abstract interfaces

#### `/src/implementations/controllers/`
**Responsibility**: Orchestrate evaluation workflows

- **`metric_eval_controller.py`** (`MetricEvalController`)
  - **What it does**: Orchestrates evaluation of multiple metrics on a single Record
  - **Dependencies**: Answer, Context, and Tool evaluators
  - **Key method**: `eval_metrics(record, model_name, metrics) -> list[MetricEvalResult]`
  - **Flow**:
    1. Validates required data via `MetricRegistry`
    2. Routes each metric to appropriate handler
    3. Executes all evaluations concurrently (`asyncio.gather`)
    4. Handles exceptions gracefully (returns error result instead of crashing)

- **`metric_completion_eval_controller.py`** (`MetricCompletionEvalController`)
  - **What it does**: Generates LLM completion, then evaluates it
  - **Dependencies**: LLM client + `MetricEvalController`

- **`gremlin_eval_controller.py`** (`GremlinEvalController`)
  - **What it does**: Gremlin query evaluation
  - **Dependencies**: Ardoq API client + generic evaluator

#### `/src/implementations/evaluators/`
**Responsibility**: Execute metric calculations using evaluation libraries

**Base Class**:
- `base_deepeval_metric_evaluator.py` - Shared logic for deepeval-based evaluators
  - Provides `_get_model()` abstract method
  - Common test case creation logic

**Segregated Evaluators** (implement segregated interfaces):
- `answer_metric_evaluator.py` - Answer relevancy
- `context_metric_evaluator.py` - Context-based metrics (hallucination, faithfulness, contextual precision/recall/relevancy)
- `tool_metric_evaluator.py` - Tool correctness
- `custom_metric_evaluator.py` - Custom evaluation logic

**Composite Evaluator**:
- **`litellm_metric_evaluator.py`** (`LiteLLMMetricEvaluator`)
  - **Pattern**: Multiple inheritance combining all segregated evaluators
  - **What it does**: Provides unified evaluator that can handle all metric types
  - **How it works**: 
    - Inherits from: `ToolMetricEvaluator`, `AnswerMetricEvaluator`, `CustomMetricEvaluator`, `ContextMetricEvaluator`
    - Implements `_get_model()` to return LiteLLM-configured deepeval model
    - All metric calculation methods inherited from parent evaluators

**Other Evaluators**:
- `generic_evaluator.py` - Generic LLM-based evaluation

#### `/src/implementations/metrics/`
**Responsibility**: Metric routing and orchestration

- **`metric_registry.py`** (`MetricRegistry`)
  - **What it does**: Maps metrics to handlers and manages metric execution
  - **Key features**:
    - Registers metrics with handlers (executor functions + validators)
    - Routes metric requests to appropriate evaluator methods
    - Validates required data before execution
    - Enables extensibility without modifying controllers
  - **Pattern**: Registry pattern for dynamic metric dispatching

- **`metric_handler.py`** (`MetricHandler`)
  - **What it does**: Encapsulates metric execution logic
  - **Fields**: `metric`, `required_fields`, `executor` (async function)
  - **Validators**: Check if Record has required data (context, tools, etc.)

#### `/src/implementations/mappers/`
- `confident.py` - Maps between internal domain models and Confident AI objects

#### `/src/implementations/repositories/`
- `dataset_repository.py` - Dataset loading/storage implementations

---

### `/src/config/` - Application Configuration

**Purpose**: Configuration loading and dependency injection

- `config.yml` - App configuration (LiteLLM settings, etc.)
- `allowed_hosts.yml` - Whitelist of allowed hosts
- `context.py` - ContextVars for request-scoped data (Ardoq API token)

---

### `/local_eval/` - Local Evaluation Scripts

**Purpose**: Development and testing scripts for local evaluation

- `evaluate_dataset.py` - Run metrics on dataset from Confident AI
- `pull_dataset.py` - Fetch dataset from Confident AI
- `run_completion_on_dataset.py` - Generate completions and push to new dataset
- `ping_litellm_connection.py` - Verify LiteLLM connectivity
- `ping_litellm_metric_connection.py` - Test metric evaluation connectivity
- `performance_test.py` - Performance benchmarking

---

### `/tests/` - Test Suite

- Unit and integration tests
- Currently includes `test_whitelist.py` for host whitelist validation

---

## Data Flow: Complete Request Lifecycle

### Evaluation Request Flow (POST `/eval/`)

```
1. HTTP Request arrives
   ↓
2. Middleware Layer
   - Host whitelist validation
   - Ardoq context setup
   ↓
3. simple_router.submit_eval()
   - Parses MetricEvalRequest (Pydantic validation)
   - Extracts: record, eval_model, metrics
   - Retrieves eval_controller from app.state
   ↓
4. MetricEvalController.eval_metrics()
   - Validates data: _validate_data(record, metrics)
     └─> MetricRegistry.get_handler().validate() for each metric
   - Evaluates metrics: _evaluate_metrics()
     └─> For each metric:
         1. Get handler from registry
         2. Create async task with handler.executor()
     └─> asyncio.gather() runs all tasks concurrently
     └─> Handle exceptions (wrap in error MetricEvalResult)
   ↓
5. MetricRegistry Routing
   - Registry maps metric → executor function
   - Executor calls appropriate evaluator method
   - Example: Metric.HALLUCINATION → _execute_hallucination()
     └─> context_evaluator.calculate_hallucination()
   ↓
6. Evaluator Execution (e.g., ContextMetricEvaluator)
   - Creates deepeval test case from Record
   - Instantiates deepeval metric (HallucinationMetric)
   - Calls metric.a_measure(case) asynchronously
   - Maps deepeval result → MetricEvalResult (domain model)
   ↓
7. Controller aggregates results
   - Returns list[MetricEvalResult]
   ↓
8. Router wraps in MetricEvalResponse
   ↓
9. FastAPI serializes to JSON
   ↓
10. HTTP Response sent to client
```

---

## Component Interactions & Relationships

### Dependency Injection via Lifespan

**File**: `src/api/config/lifespan.py`

**At Application Startup**:
1. Load config from `config.yml`
2. Initialize LiteLLM client with API base + key
3. Create `LiteLLMMetricEvaluator` (composite evaluator)
4. Create `GenericEvaluator` with LLM client
5. Initialize controllers:
   - `MetricEvalController` (answer/context/tool evaluators)
   - `MetricCompletionEvalController` (LLM client + eval controller)
   - `GremlinEvalController` (Ardoq API client + generic evaluator)
6. Store all instances in `app.state`

**Router Access Pattern**:
```python
controller: MetricEvalController = request.app.state.eval_controller
```

---

### Multiple Inheritance Pattern (LiteLLMMetricEvaluator)

**Why Multiple Inheritance?**
- Combines all segregated evaluators into single concrete implementation
- Each parent evaluator provides domain-specific metric calculations
- Base class (`BaseDeepEvalMetricEvaluator`) provides shared deepeval logic
- `LiteLLMMetricEvaluator` only needs to implement `_get_model()`

**Inheritance Chain**:
```
LiteLLMMetricEvaluator
    ├─> ToolMetricEvaluator (extends BaseDeepEvalMetricEvaluator)
    ├─> AnswerMetricEvaluator (extends BaseDeepEvalMetricEvaluator)
    ├─> CustomMetricEvaluator (extends BaseDeepEvalMetricEvaluator)
    └─> ContextMetricEvaluator (extends BaseDeepEvalMetricEvaluator)
```

**Result**: Single evaluator instance can handle all metric types

---

### MetricRegistry Pattern

**Purpose**: Decouple controllers from specific evaluators

**How It Works**:
1. Registry initialized with evaluator instances (answer, context, tool)
2. Each metric registered with:
   - `Metric` enum value
   - Required fields (context, tools, etc.)
   - Executor function (async)
3. Controllers call `registry.get_handler(metric)` to route requests
4. Handler validates data, then executes evaluation

**Benefits**:
- Add new metrics without modifying controller code
- Centralized metric management
- Easy to test (mock registry handlers)
- Validates prerequisites before evaluation

---

## Key Design Patterns

### 1. Interface Segregation
Evaluators split by domain (answer, context, tool, custom) to avoid fat interfaces

### 2. Dependency Inversion
Controllers depend on interfaces (ABC), not concrete implementations

### 3. Registry Pattern
`MetricRegistry` manages metric routing dynamically

### 4. Composite Pattern
`LiteLLMMetricEvaluator` combines multiple evaluators via inheritance

### 5. Orchestration Pattern
Controllers orchestrate workflows; evaluators handle business logic

### 6. Async/Await Throughout
All I/O operations (LLM calls, API requests) are async for performance

---

## External Dependencies

### Key Libraries
- **FastAPI** - Web framework
- **deepeval** - LLM evaluation metrics library
- **ardoq_ai** - Shared domain models (Context, Tool, ToolResult) from monorepo
- **litellm** - Unified LLM API interface
- **pydantic** - Data validation
- **asyncio** - Async concurrency

### Integration: ardoq_ai Library
**Location**: `../../libs/ardoq_ai/`  
**Purpose**: Shared domain models used across AI packages

**Used Models**:
- `Context` - Retrieved documents/context for evaluation
- `Tool` - Tool definitions
- `ToolResult` - Tool invocation results
- `LiteLLMClient` - LLM client abstraction
- `ArdoqAPIClient` - Ardoq API client

**Import Pattern**:
```python
from ardoq_ai.domain import Context, Tool, ToolResult
from ardoq_ai.services import LiteLLMClient, ArdoqAPIClient
```

---

## Extension Points

### Adding a New Metric

**Steps**:
1. Add to `Metric` enum (`src/domain/eval/metric.py`)
2. Add method to appropriate interface (`IAnswerMetricEvaluator`, `IContextMetricEvaluator`, etc.)
3. Implement method in evaluator (`AnswerMetricEvaluator`, `ContextMetricEvaluator`, etc.)
4. Register in `MetricRegistry._register_metrics()` with executor and required fields

**No changes needed to**:
- Controllers
- Routers
- Domain models

### Swapping Evaluation Backend (deepeval → Pydantic AI)

**Steps**:
1. Create new segregated evaluators (e.g., `PydanticAIContextMetricEvaluator`)
2. Create composite evaluator combining segregated evaluators
3. Update `lifespan.py` to instantiate new evaluator
4. All controllers/routers remain unchanged (they depend on interfaces)

---

## Configuration & Environment

### Configuration Files
- `moon.yml` - Moonrepo task definitions, env vars
- `pyproject.toml` - Python dependencies (uv)
- `config.yml` - App config (LiteLLM API base, etc.)
- `allowed_hosts.yml` - Host whitelist

### Environment Variables (moon.yml)
- `PYTHON_ENV` - `dev` or `prod` (affects auth middleware)
- `LITELLM_API_KEY` - LiteLLM gateway API key
- `LITELLM_API_BASE` - LiteLLM gateway URL

### Authentication
- **Dev mode** (`PYTHON_ENV=dev`): Auth disabled
- **Prod mode** (default): Header-based auth via ingress routing to Ardoq API
- Required headers: `Authorization`, `host`

---

## Running the Project

### Via Moonrepo
```bash
moon run ai_observability:run
```

### Local Development
```bash
uv sync                    # Install dependencies
uv run pytest tests/       # Run tests
```

### Docker
```bash
docker build -t ai_observability .
docker run -p 8976:8976 ai_observability
```

---

## Testing Strategy

### Local Evaluation Scripts
Use scripts in `local_eval/` for manual testing and development:
- Test connectivity: `ping_litellm_connection.py`
- Evaluate datasets: `evaluate_dataset.py`
- Performance testing: `performance_test.py`

### Unit Testing
- Mock interfaces (ABC) for isolated testing
- Example: `MockContextMetricEvaluator` implementing `IContextMetricEvaluator`

### Integration Testing
- Test full request lifecycle via FastAPI TestClient
- Test with real LiteLLM/deepeval integration

---

## Common Development Tasks

### Debugging Request Flow
1. Set breakpoint in router
2. Follow controller method
3. Trace registry handler lookup
4. Step into evaluator implementation

### Adding Custom Metric
1. Define in `Metric` enum
2. Add to `ICustomMetricEvaluator` interface
3. Implement in `CustomMetricEvaluator`
4. Register in `MetricRegistry`
5. Test via `/eval/` endpoint

### Investigating Evaluation Failures
1. Check error result in response (score=-1.0, reasoning contains exception)
2. Review evaluator implementation
3. Test with `local_eval/` scripts
4. Verify LiteLLM connectivity

---

## File Naming Conventions

### Interfaces
- Prefix: `i_` (e.g., `i_context_metric_evaluator.py`)
- CamelCase class names: `IContextMetricEvaluator`

### Implementations
- Descriptive names matching interface (e.g., `context_metric_evaluator.py`)
- CamelCase class names: `ContextMetricEvaluator`

### Routers
- Suffix: `_router` (e.g., `simple_router.py`)
- Router instance: `simple_router = APIRouter(...)`

### Controllers
- Suffix: `_controller` (e.g., `metric_eval_controller.py`)
- CamelCase class names: `MetricEvalController`

---

## Summary: Key Responsibilities

| Component | Responsibility |
|-----------|---------------|
| **Routers** | HTTP request/response handling |
| **Controllers** | Orchestrate evaluation workflows |
| **MetricRegistry** | Route metrics to handlers, validate data |
| **Evaluators** | Execute metric calculations using libraries |
| **Domain Models** | Framework-agnostic business entities |
| **Interfaces** | Abstract contracts for implementations |
| **Middleware** | Host validation, context management |
| **Lifespan** | App initialization, dependency injection |
| **Local Eval Scripts** | Development testing and debugging |

---

## Architecture Principles

1. **Separation of Concerns**: API layer separate from business logic
2. **Dependency Inversion**: Depend on interfaces, not implementations
3. **Interface Segregation**: Small, focused interfaces
4. **Open/Closed**: Extend via new implementations, not modifications
5. **Single Responsibility**: Each class has one clear purpose
6. **Async-First**: All I/O operations are async for performance
7. **Domain-Driven**: Domain models are framework-agnostic

---

## Related Resources

- **Project README**: `/projects/ai_observability/README.md`
- **Ardoq AI Library**: `../../libs/ardoq_ai/`
- **Moonrepo Config**: `moon.yml`
- **Dependencies**: `pyproject.toml`, `uv.lock`
