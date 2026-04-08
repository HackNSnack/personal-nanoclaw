---
tags: [ai_observability, refactor, architecture]
type: work
status: in-progress
branch: AI-fix-eval-code
---

# ai_observability: Refactor to Functional Architecture

Branch `AI-fix-eval-code` restructures the entire `ai_observability` project from a class-based OOP architecture (interfaces, controllers, registry) to a functional architecture with plain functions, partials, and dict-based dispatch.

## Old vs New Directory Structure

```mermaid
block-beta
  columns 2

  block:OLD["OLD STRUCTURE"]:1
    columns 1
    A1["src/api/routers/"]
    A2["src/api/domain/requests/"]
    A3["src/config/"]
    A4["src/domain/eval/"]
    A5["src/domain/data/"]
    A6["src/interfaces/evaluators/"]
    A7["src/implementations/controllers/"]
    A8["src/implementations/evaluators/"]
    A9["src/implementations/metrics/"]
    A10["src/implementations/mappers/"]
    A11["src/implementations/repositories/"]
  end

  block:NEW["NEW STRUCTURE"]:1
    columns 1
    B1["src/api/ (app + middleware only)"]
    B2["src/metrics/ (router, evaluate, evaluators)"]
    B3["src/metrics/domain/"]
    B4["src/custom_eval/ (router, evaluate, evaluators)"]
    B5["src/shared/config/"]
    B6["src/shared/domain/"]
    B7["src/utils/"]
  end
```

**Key change:** Organised by feature domain (`metrics/`, `custom_eval/`) instead of by architectural layer (`interfaces/`, `implementations/`).

## Old Architecture — Class-Based

```mermaid
graph TD
    subgraph "API Layer"
        R1[simple_router]
        R2[completion_router]
        R3[gremlin_router]
        R4[confident_router]
    end

    subgraph "Controllers"
        C1[MetricEvalController]
        C2[MetricCompletionEvalController]
        C3[GremlinEvalController]
        C4[ConfidentController]
    end

    subgraph "Registry"
        MR[MetricRegistry]
        MH[MetricHandler]
    end

    subgraph "Interfaces"
        IA[IAnswerMetricEvaluator]
        IC[IContextMetricEvaluator]
        IT[IToolMetricEvaluator]
        ICU[ICustomEvaluator]
    end

    subgraph "Implementations"
        BD[BaseDeepEvalMetricEvaluator]
        AE[AnswerMetricEvaluator]
        CE[ContextMetricEvaluator]
        TE[ToolMetricEvaluator]
        GE[GenericEvaluator]
    end

    R1 --> C1
    R2 --> C2
    R3 --> C3
    R4 --> C4

    C1 --> MR
    C2 --> MR
    MR --> MH
    MH --> AE & CE & TE

    C3 --> GE

    IA --> AE
    IC --> CE
    IT --> TE
    ICU --> GE
    BD --> AE & CE & TE

    style MR fill:#f9d,stroke:#333
    style BD fill:#bbf,stroke:#333
```

### Old Request Flow (Metric Evaluation)

```mermaid
sequenceDiagram
    participant Client
    participant Router as simple_router
    participant Ctrl as MetricEvalController
    participant Reg as MetricRegistry
    participant Handler as MetricHandler
    participant Eval as *MetricEvaluator

    Client->>Router: POST /metric
    Router->>Ctrl: evaluate_metrics(request)
    loop For each metric
        Ctrl->>Reg: get_handler(metric)
        Reg-->>Ctrl: MetricHandler
        Ctrl->>Ctrl: validate requirements
        Ctrl->>Ctrl: create async task
    end
    Ctrl->>Eval: asyncio.gather(*tasks)
    Eval-->>Ctrl: list[MetricEvalResult]
    Ctrl-->>Router: MetricEvalResponse
    Router-->>Client: 200 OK
```

### Old Dependency Injection

```mermaid
graph LR
    subgraph "lifespan.py"
        L[Lifespan Context Manager]
    end

    L -->|constructs| AE[AnswerMetricEvaluator]
    L -->|constructs| CE[ContextMetricEvaluator]
    L -->|constructs| TE[ToolMetricEvaluator]
    L -->|constructs| GE[GenericEvaluator]

    AE & CE & TE -->|injected into| MR[MetricRegistry]
    MR -->|injected into| C1[MetricEvalController]
    MR -->|injected into| C2[CompletionEvalController]
    GE -->|injected into| C3[GremlinEvalController]

    C1 & C2 & C3 -->|stored in| AS[app.state]

    style L fill:#ffd,stroke:#333
    style AS fill:#dfd,stroke:#333
```

## New Architecture — Functional

```mermaid
graph TD
    subgraph "API Layer"
        R1[metrics/router]
        R3[custom_eval/router]
    end

    subgraph "Orchestration Functions"
        E1["evaluate_metrics()"]
        E3["eval_gremlin_steps()"]
    end

    subgraph "Evaluator Functions"
        AF["evaluate_answer_relevancy()"]
        CF["evaluate_context_metric()"]
        TF["evaluate_tool_correctness()"]
        CUF["evaluate_custom()"]
    end

    subgraph "Shared Utilities"
        DU["deepeval_utils"]
        MC["map_context_to_strings()"]
        GM["get_deepeval_model()"]
        CM["create_test_case_and_measure()"]
    end

    subgraph "Context Variables"
        CV["litellm_context\n(api_base, api_key)"]
    end

    R1 --> E1
    R3 --> E3

    E1 -->|"asyncio.gather()"| AF & CF & TF
    E3 -->|"gremlin queries → evaluate"| CUF

    AF & CF & TF --> DU
    DU --> MC & GM & CM
    GM --> CV

    style E1 fill:#f9d,stroke:#333
    style DU fill:#bbf,stroke:#333
    style CV fill:#ffd,stroke:#333
```

### New Request Flow (Metric Evaluation)

```mermaid
sequenceDiagram
    participant Client
    participant Router as metrics/router
    participant Eval as evaluate_metrics()
    participant Fn as evaluator function

    Client->>Router: POST /eval/metric
    Router->>Router: get evaluators dict from app.state
    Router->>Eval: evaluate_metrics(metrics, record, evaluators)
    Eval->>Eval: validate all metrics registered
    Eval->>Eval: validate record fields per metric
    Eval->>Fn: asyncio.gather(*[fn(model, record) for each metric])
    Note over Fn: Each evaluator is a plain async function
    Fn-->>Eval: list[MetricEvalResult]
    Eval-->>Router: results
    Router-->>Client: MetricEvalResponse
```

### New Dependency Injection

```mermaid
graph LR
    subgraph "lifespan.py"
        L[Lifespan Context Manager]
        SC["set_litellm_config()"]
    end

    L -->|sets| CV["Context Vars\n(api_base, api_key)"]
    L -->|builds| ED["evaluators dict\n{Metric → async fn}"]
    L -->|creates| CU["custom_evaluator\npartial(evaluate_custom, ...)"]
    L -->|gets| M["eval_model\nget_model(deployment)"]

    ED & CU & M -->|stored in| AS[app.state]

    style L fill:#ffd,stroke:#333
    style CV fill:#fcf,stroke:#333
    style AS fill:#dfd,stroke:#333
```

## What Changed — Summary

```mermaid
graph LR
    subgraph "Removed"
        direction TB
        X1["4 Interfaces (ABC)"]
        X2["MetricRegistry class"]
        X3["MetricHandler class"]
        X4["4 Controller classes"]
        X5["BaseDeepEvalMetricEvaluator"]
        X6["3 Evaluator classes"]
        X7["DatasetRepository"]
        X8["ConfidentController + mapper"]
        X9["4 separate routers"]
    end

    subgraph "Replaced With"
        direction TB
        Y1["Plain async functions"]
        Y2["dict[Metric, Callable]"]
        Y3["Lambda wrappers in lifespan"]
        Y4["Orchestration functions"]
        Y5["Shared deepeval_utils module"]
        Y6["3 evaluator function modules"]
        Y7["(removed entirely)"]
        Y8["(removed entirely)"]
        Y9["2 domain-scoped routers"]
    end

    X1 -.-> Y1
    X2 -.-> Y2
    X3 -.-> Y3
    X4 -.-> Y4
    X5 -.-> Y5
    X6 -.-> Y6
    X7 -.-> Y7
    X8 -.-> Y8
    X9 -.-> Y9

    style X1 fill:#fcc,stroke:#933
    style X2 fill:#fcc,stroke:#933
    style X3 fill:#fcc,stroke:#933
    style X4 fill:#fcc,stroke:#933
    style X5 fill:#fcc,stroke:#933
    style X6 fill:#fcc,stroke:#933
    style X7 fill:#fcc,stroke:#933
    style X8 fill:#fcc,stroke:#933
    style X9 fill:#fcc,stroke:#933
    style Y1 fill:#cfc,stroke:#393
    style Y2 fill:#cfc,stroke:#393
    style Y3 fill:#cfc,stroke:#393
    style Y4 fill:#cfc,stroke:#393
    style Y5 fill:#cfc,stroke:#393
    style Y6 fill:#cfc,stroke:#393
    style Y7 fill:#cfc,stroke:#393
    style Y8 fill:#cfc,stroke:#393
    style Y9 fill:#cfc,stroke:#393
```

## Endpoint Changes

| Old Endpoint | New Endpoint | Notes |
|---|---|---|
| `POST /metric` | `POST /eval/metric` | Same logic, functional orchestration |
| `POST /with_completion/metric` | `POST /eval/with_completion/metric` | Now uses `eval_with_completion()` |
| `POST /gremlin/custom` | `POST /eval/gremlin/custom` | Moved to `custom_eval/` module |
| `POST /confident` | *(removed)* | Confident integration dropped |

## Net Impact

- **-1422 lines** deleted, **+1267 lines** added (net **-155 lines**)
- 4 interfaces, 4 controllers, 1 registry, 1 base class → plain functions + a dict
- Organisation shifted from architectural layers to feature domains
- Context variables replace constructor-injected config
- `functools.partial` replaces class instantiation for DI

## Related

- [[2026-03-24 Refactor ai_observability to functional patterns]]
