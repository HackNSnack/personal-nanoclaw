---
tags: [architecture, agents, context, reference]
type: reference
status: done
---

# Dynamic Agent Context Flow

How context variables are created and passed through the agent execution layers on the `AI-dynamically-return-agents` branch.

## Full Request Lifecycle

```mermaid
flowchart TD
    subgraph HTTP["HTTP Layer"]
        REQ["Incoming HTTP Request"]
        MW["Middleware: set_ardoq_context"]
    end

    subgraph APP["App State (created at startup in lifespan.py)"]
        direction LR
        DM["default_model"]
        EMB["embedder"]
        ALOG["logger"]
        LKEY["litellm_api_key"]
        LBASE["litellm_api_base"]
    end

    subgraph CTX["Context Variables (created per-request in middleware)"]
        direction LR
        AUTH["ardoq_auth: Authorization"]
        BURL["ardoq_api_base_url: str"]
    end

    subgraph DISPATCH["Dispatcher (streaming_utils / non_streaming_utils)"]
        PARSE["Parse AgentRequest\n(discriminated union)"]

        subgraph CREATED_HERE["Created in dispatcher"]
            direction LR
            BCTX["BaseContext\n• authorization\n• base_url\n• logger"]
            CPARAMS["completion_params\n• new_message\n• model\n• message_history\n• logger\n• instructions (override)\n• model_settings (override)"]
        end

        MATCH["match request type →\nselect agent + build deps"]
    end

    subgraph DEPS["Agent-Specific Dependencies (created in dispatcher match)"]
        direction TB
        BASE_DEPS["BaseContext fields\n(authorization, base_url, logger)"]
        REPORT["ReportChatDependencies\n+ report_id"]
        INSIGHT["InsightAgentDependencies\n+ report_id"]
        DASH["DashboardAgentDependencies\n+ dashboard_id"]
        VP["ViewpointAgentDependencies\n+ viewpoint_id"]
        QB["AiQueryBuilderDependencies\n+ workspace_ids"]
        META["MetamodelAgentDependencies\n(no extras)"]
        DEF["DefaultAgentDependencies\n(empty)"]
        SCORE["ScoringAgentDependencies\n(empty)"]
    end

    subgraph COMPLETION["Completion Layer (streaming.py / non_streaming.py)"]
        OVERRIDE{"instructions\nprovided?"}
        WITH_OV["agent.override(instructions=...)"]
        NO_OV["Use @instructions decorator"]
        RUN["agent.run() / agent.run_stream_events()\n• message = new_message.content\n• deps = dependencies\n• model = model\n• message_history = mapped history\n• model_settings = override or default"]
    end

    subgraph AGENT["Agent Execution"]
        INST["@instructions decorator\nreceives RunContext[DepsT]\n→ accesses ctx.deps, ctx.model"]
        TOOLS["Tool functions\nreceive DepsT via injection\n→ access deps.authorization,\n   deps.base_url, deps.logger"]
    end

    subgraph SUB["Sub-Agent (e.g. scale_interpreter in prepare.py)"]
        THROWAWAY["Throwaway Agent()\n• deps_type = None\n• deps = None\n• model = parent's model\n• own system_prompt\n• own output_type"]
        CTXVAR["Still accesses:\n• ardoq_auth.get()\n• ardoq_api_base_url.get()\n(thread-safe context vars)"]
    end

    REQ --> MW
    MW -->|sets| CTX
    MW --> PARSE
    APP -->|"app.state.default_model\napp.state.logger"| PARSE
    CTX -->|".get()"| CREATED_HERE
    PARSE --> CREATED_HERE
    CREATED_HERE --> MATCH
    MATCH -->|"**base_context.model_dump()\n+ agent-specific fields"| DEPS
    BASE_DEPS -.->|inherited by all| REPORT & INSIGHT & DASH & VP & QB & META & DEF & SCORE
    DEPS -->|"dependencies"| COMPLETION
    CPARAMS -->|"**completion_params"| COMPLETION

    OVERRIDE -->|yes| WITH_OV --> RUN
    OVERRIDE -->|no| NO_OV --> RUN
    COMPLETION --> OVERRIDE

    RUN --> AGENT
    INST -->|"calls API/prepare fns"| SUB
    TOOLS -->|"can create"| SUB
    THROWAWAY -.->|"inherits via\nthread context"| CTXVAR

    style HTTP fill:#2d3748,stroke:#4a5568,color:#e2e8f0
    style APP fill:#1a365d,stroke:#2b6cb0,color:#bee3f8
    style CTX fill:#742a2a,stroke:#c53030,color:#fed7d7
    style DISPATCH fill:#22543d,stroke:#38a169,color:#c6f6d5
    style DEPS fill:#553c9a,stroke:#805ad5,color:#e9d8fd
    style COMPLETION fill:#744210,stroke:#d69e2e,color:#fefcbf
    style AGENT fill:#285e61,stroke:#4fd1c5,color:#b2f5ea
    style SUB fill:#4a2040,stroke:#d53f8c,color:#fed7e2
```

## Override Mechanism Detail

```mermaid
flowchart LR
    subgraph REQUEST["Request"]
        SP["system_prompt: str | None"]
        MT["model: DeploymentTag | None"]
    end

    subgraph OVERRIDE_CHECK["Dispatch Logic"]
        CHECK_SP{"system_prompt\nis not None?"}
        CHECK_MT{"model\nis not None?"}
    end

    subgraph RESULT["Effect"]
        OV_YES["agent.override(instructions=system_prompt)\n→ @instructions decorator SKIPPED\n→ literal string used as prompt"]
        OV_NO["@instructions decorator called\n→ dynamic prompt from RunContext"]
        MS_YES["get_model_settings(get_deployment(tag))\n→ overrides agent's default settings"]
        MS_NO["Agent's built-in model_settings used"]
    end

    SP --> CHECK_SP
    CHECK_SP -->|yes| OV_YES
    CHECK_SP -->|no| OV_NO
    MT --> CHECK_MT
    CHECK_MT -->|yes| MS_YES
    CHECK_MT -->|no| MS_NO

    style REQUEST fill:#2d3748,stroke:#4a5568,color:#e2e8f0
    style OVERRIDE_CHECK fill:#744210,stroke:#d69e2e,color:#fefcbf
    style RESULT fill:#22543d,stroke:#38a169,color:#c6f6d5
```

## Context Variables Summary

| Layer | Creates | Passes Down |
|-------|---------|-------------|
| **Lifespan (startup)** | `default_model`, `embedder`, `logger`, litellm keys | Stored on `app.state` |
| **Middleware** | `ardoq_auth`, `ardoq_api_base_url` (ContextVars) | Implicitly available via `.get()` |
| **Dispatcher** | `BaseContext`, `completion_params`, agent-specific `Dependencies` | `dependencies` + `**completion_params` to completion fn |
| **Completion fn** | `run_params` dict (mapped history, deps, model, settings) | All of `run_params` to `agent.run()` |
| **Agent execution** | `RunContext[DepsT]` (wraps deps + model ref) | `ctx.deps` to `@instructions` and tools |
| **Sub-agent** | Throwaway `Agent()` with `deps=None` | Reuses parent's `model`; reads ContextVars directly |

## Key Insight

Agents are **module-level singletons**, not factory-created. The "dynamic" part is:
1. **Dispatch-time selection** via `match` on request type
2. **Runtime override** of prompts/model via `agent.override()` context manager
3. **Dependency injection** — each request gets fresh `Dependencies` with request-scoped auth/context
4. **Sub-agents** inherit the model instance but NOT the dependency object; they rely on thread-safe ContextVars for auth
