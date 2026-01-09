# Implementation Details

## ardoq_ai Package Structure

### Current State (After Refactoring)

```
ardoq_ai/
├── domain/                    # Domain models (unchanged)
│   ├── ardoq/                # Ardoq-specific models
│   ├── completion/           # Completion models
│   ├── rag/                  # RAG models
│   └── tools/                # Tool models
├── services/                 # Renamed from implementations
│   ├── clients/
│   │   └── ardoq/
│   │       └── ardoq_api_client.py  # Concrete class (no interface)
│   └── completion/
│       └── generic/
│           ├── llm_client.py        # Abstract base class
│           └── litellm_client.py    # Concrete implementation
└── interfaces/               # Only empty __init__.py files remain
```

### Key Classes

#### LLMClient (Base Class)
```python
class LLMClient:
    """Abstract base for LLM clients. Not an ABC/interface anymore."""
    
    @abstractmethod
    def _get_model(self, model_name: str) -> Model:
        raise NotImplementedError()
    
    async def run_completion(self, ...) -> CompletionResult:
        # Concrete implementation using _get_model
```

#### LiteLLMClient (Concrete)
```python
class LiteLLMClient(LLMClient):
    def __init__(self, api_base: str, api_key: str):
        self.api_base = api_base
        self.api_key = api_key
    
    def _get_model(self, model_name: str) -> Model:
        return OpenAIChatModel(...)
```

#### ArdoqAPIClient (Concrete)
```python
class ArdoqAPIClient:
    """Direct concrete implementation. No interface."""
    
    async def query_chatbot(self, ...) -> ChatbotResponse:
        # Implementation
    
    async def execute_query(self, ...) -> GremlinExecutionResponse:
        # Implementation
```

## ai_observability Project Structure

### Current State (After Refactoring)

```
ai_observability/
├── src/
│   ├── api/
│   │   ├── config/
│   │   │   └── lifespan.py          # Direct instantiation
│   │   └── routers/                 # Use request.app.state
│   ├── implementations/
│   │   ├── controllers/             # Concrete classes (no interfaces)
│   │   │   ├── metric_eval_controller.py
│   │   │   ├── gremlin_eval_controller.py
│   │   │   └── metric_completion_eval_controller.py
│   │   ├── evaluators/              # PRESERVED: Implement interfaces
│   │   │   ├── litellm_metric_evaluator.py
│   │   │   ├── generic_evaluator.py
│   │   │   └── (various metric evaluators)
│   │   └── repositories/            # PRESERVED: Implement interfaces
│   │       └── dataset_repository.py
│   └── interfaces/
│       ├── controllers/             # REMOVED (empty)
│       ├── evaluators/              # PRESERVED
│       │   ├── i_answer_metric_evaluator.py
│       │   ├── i_context_metric_evaluator.py
│       │   ├── i_tool_metric_evaluator.py
│       │   ├── i_generic_evaluator.py
│       │   └── (other metric interfaces)
│       └── repositories/            # PRESERVED
│           └── i_dataset_repository.py
└── local_eval/
    └── init.py                      # Helper functions for local scripts
```

### Instantiation Pattern (lifespan.py)

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    config.CONFIG = config.load_config()
    
    litellm_api_base = config.CONFIG.lite_llm.api_base
    litellm_api_key = config.CONFIG.lite_llm.api_key.get_secret_value()
    
    # Direct instantiation - no factory functions
    metric_evaluator = LiteLLMMetricEvaluator(litellm_api_base, litellm_api_key)
    llm_client = LiteLLMClient(litellm_api_base, litellm_api_key)
    generic_evaluator = GenericEvaluator(llm_client)
    
    eval_controller = MetricEvalController(
        answer_evaluator=metric_evaluator,
        context_evaluator=metric_evaluator,
        tool_evaluator=metric_evaluator,
    )
    completion_eval_controller = MetricCompletionEvalController(
        llm_client=llm_client,
        metric_evaluator=eval_controller,
    )
    gremlin_controller = GremlinEvalController(
        ArdoqAPIClient(),
        generic_evaluator,
    )
    
    # Store in app.state
    app.state.metric_evaluator = metric_evaluator
    app.state.llm_client = llm_client
    app.state.eval_controller = eval_controller
    app.state.completion_eval_controller = completion_eval_controller
    app.state.gremlin_controller = gremlin_controller
    
    yield
```

### Router Pattern

```python
@simple_router.post(path="/", response_model=MetricEvalResponse)
async def submit_eval(req: MetricEvalRequest, request: Request) -> MetricEvalResponse:
    controller: MetricEvalController = request.app.state.eval_controller
    return MetricEvalResponse(
        results=await controller.eval_metrics(req.record, req.eval_model, req.metrics)
    )
```

### Local Scripts Pattern (init.py)

```python
def get_litellm_client():
    from ardoq_ai.services import LiteLLMClient
    from src.config import get_config
    
    config = get_config()
    return LiteLLMClient(
        config.lite_llm.api_base,
        config.lite_llm.api_key.get_secret_value(),
    )

def get_metric_eval_controller():
    from src.implementations.controllers.metric_eval_controller import MetricEvalController
    
    evaluator = get_litellm_metric_evaluator()
    return MetricEvalController(
        answer_evaluator=evaluator,
        context_evaluator=evaluator,
        tool_evaluator=evaluator,
    )
```

## Migration Steps Performed

1. **Phase 1:** Removed controller interfaces and DI system
   - Deleted interface files
   - Removed `@override` decorators
   - Removed factory functions
   - Updated lifespan to direct instantiation

2. **Phase 2:** Removed ILLMClient interface
   - Deleted interface file
   - Updated imports to use concrete LLMClient/LiteLLMClient
   - Cleaned up empty interface directories

3. **Phase 3:** Removed IArdoqAPIClient interface
   - Deleted interface file
   - Updated imports to use concrete ArdoqAPIClient
   - Cleaned up empty interface directories

4. **Phase 4:** Renamed implementations to services
   - Renamed directory in ardoq_ai
   - Updated all import paths
   - Updated __init__.py files

5. **Phase 5:** Verified and updated
   - Fixed router patterns
   - Removed dependencies.py
   - Updated local_eval scripts
   - All tests passing (11/11)

## Code Patterns

### Before (With Abstractions)
```python
# Interface
class IMetricEvalController(ABC):
    @abstractmethod
    async def eval_metrics(self, ...) -> list[MetricEvalResult]:
        raise NotImplementedError()

# Implementation
class MetricEvalController(IMetricEvalController):
    @override
    async def eval_metrics(self, ...) -> list[MetricEvalResult]:
        # Implementation

# Factory
def get_metric_eval_controller() -> IMetricEvalController:
    return MetricEvalController(...)

# Router
async def submit_eval(req: Request, controller: MetricEvalControllerDep):
    # MetricEvalControllerDep is Annotated[IMetricEvalController, Depends(...)]
```

### After (Direct Usage)
```python
# Concrete class only
class MetricEvalController:
    async def eval_metrics(self, ...) -> list[MetricEvalResult]:
        # Implementation

# Lifespan instantiation
eval_controller = MetricEvalController(...)
app.state.eval_controller = eval_controller

# Router
async def submit_eval(req: Request, request: Request):
    controller: MetricEvalController = request.app.state.eval_controller
```

## Testing Impact

### No Changes Required
- Tests import concrete classes directly
- Mocking works the same (mock concrete classes)
- All 11 existing tests pass without modification

### Test Pattern
```python
from src.implementations.controllers.metric_eval_controller import MetricEvalController

def test_eval_metrics():
    controller = MetricEvalController(
        answer_evaluator=mock_evaluator,
        context_evaluator=mock_evaluator,
        tool_evaluator=mock_evaluator,
    )
    result = await controller.eval_metrics(...)
```
