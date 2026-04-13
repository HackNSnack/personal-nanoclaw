---
tags: [architecture, evaluation, llm, observability, mermaid]
type: work
status: in-progress
---

# LLM Evaluation Pipeline - Visual Guide

## 1. High-Level System Overview

```mermaid
graph TB
    subgraph REGIONS["Customer Regions (per-region)"]
        direction TB
        subgraph EU["production (eu-west-1)"]
            EU_DB[("RDS PostgreSQL<br/>Sessions + Chat History")]
            EU_JOB["Nightly Eval Job<br/>(Clojure)"]
            EU_OBSV["ai_observability<br/>(Python)"]
            EU_LLM["AWS Bedrock /<br/>Azure OpenAI"]
        end

        subgraph US["us1 (us-east-1)"]
            US_DB[("RDS PostgreSQL")]
            US_JOB["Nightly Eval Job<br/>(Clojure)"]
            US_OBSV["ai_observability<br/>(Python)"]
            US_LLM["AWS Bedrock /<br/>Azure OpenAI"]
        end

        subgraph OTHER["au / uae / ca"]
            OT_JOB["Same pattern<br/>per region"]
        end
    end

    subgraph HQ["HQ (eu-north-1)"]
        REDSHIFT[("Redshift<br/>Aggregated Scores")]
        GRAFANA["Grafana<br/>Dashboard"]
    end

    EU_JOB --> EU_DB
    EU_JOB -- "session data" --> EU_OBSV
    EU_OBSV --> EU_LLM
    EU_OBSV -- "scores only" --> EU_JOB
    EU_JOB -- "scores + metadata<br/>(no raw data)" --> REDSHIFT

    US_JOB --> US_DB
    US_JOB -- "session data" --> US_OBSV
    US_OBSV --> US_LLM
    US_OBSV -- "scores only" --> US_JOB
    US_JOB -- "scores + metadata<br/>(no raw data)" --> REDSHIFT

    OT_JOB -- "scores + metadata" --> REDSHIFT
    REDSHIFT --> GRAFANA

    style REGIONS fill:#bbf,stroke:#333
    style HQ fill:#fbf,stroke:#333
    style EU fill:#ddf,stroke:#336
    style US fill:#ddf,stroke:#336
    style OTHER fill:#ddf,stroke:#336
```

## 2. Privacy Boundary — Data Flow

```mermaid
graph TB
    subgraph REGION["Customer Region (e.g. production)"]
        subgraph SENSITIVE["🔒 Sensitive Zone — data stays here"]
            DB[("RDS<br/>Sessions")]
            JOB["Nightly Eval Job<br/>(Clojure)"]
            OBSV["ai_observability<br/>(Python)"]
            LLM["LLM<br/>(Bedrock/OpenAI)"]
            RAW["Raw session data:<br/>prompts, responses, tool calls"]
        end

        subgraph SAFE["✅ Safe Zone — can leave region"]
            SPACER[" "]
            SCORES["Aggregated Scores"]
            FIELDS["org_id, region, metric_name,<br/>score, session_id, tool_names,<br/>agent_type, timestamp, sample_size"]
        end
    end

    subgraph HQ["HQ"]
        STORE[("Redshift")]
        DASH["Grafana"]
    end

    DB --> JOB
    JOB --> OBSV
    OBSV --> LLM
    LLM --> OBSV
    OBSV -- "scores only" --> JOB
    JOB -- "aggregate &<br/>anonymise" --> SPACER
    SPACER --> SCORES
    SCORES --> FIELDS
    FIELDS -- "cross-region transfer" --> STORE
    STORE --> DASH

    RAW -. "NEVER leaves region" .-> RAW

    style SENSITIVE fill:#fdd,stroke:#c33
    style SAFE fill:#dfd,stroke:#3c3
    style HQ fill:#fbf,stroke:#333
    style SPACER fill:#dfd,stroke:#dfd,color:#dfd
```

## 3. Nightly Job Sequence

```mermaid
sequenceDiagram
    participant CRON as CronJob / Scheduler
    participant JOB as Nightly Eval Job (Clojure)
    participant DB as RDS PostgreSQL
    participant OBSV as ai_observability (Python)
    participant LLM as LLM (Bedrock/OpenAI)
    participant STORE as HQ Redshift

    Note over CRON,STORE: Runs nightly per region (e.g. 02:00 UTC)

    CRON->>JOB: trigger nightly eval

    JOB->>DB: get opted-in orgs<br/>(eval_enabled = true)
    DB-->>JOB: [org_1, org_2, ..., org_n]

    loop For each opted-in org
        JOB->>DB: randomly select N sessions<br/>(last 24h, completed)
        DB-->>JOB: [session_1, ..., session_N]

        loop For each session
            JOB->>DB: fetch full session<br/>(messages, tool calls, results)
            DB-->>JOB: session data

            JOB->>OBSV: POST /eval/session<br/>{session_id, messages, tool_calls}
            OBSV->>LLM: LLM-as-judge evaluation
            LLM-->>OBSV: raw scores per metric
            OBSV-->>JOB: {scores, metadata}<br/>(no raw data in response)

            Note over JOB: Discard raw session data<br/>Keep only scores + metadata
        end

        JOB->>JOB: aggregate scores per org<br/>(mean, median, p95, count)
    end

    JOB->>STORE: push aggregated scores<br/>(org_id, region, metrics,<br/>timestamp, tool_names)

    Note over STORE: Raw data never reaches HQ
```

## 4. Component Responsibilities

```mermaid
graph TB
    subgraph CLOJURE["Nightly Eval Job (Clojure)"]
        C1["CronJob scheduling"]
        C2["Query opted-in orgs"]
        C3["Select random sessions from DB"]
        C4["Fetch full session data"]
        C5["Aggregate scores per org"]
        C6["Push scores to HQ Redshift"]
    end

    subgraph PYTHON["ai_observability (Python)"]
        P1["POST /eval/session endpoint"]
        P2["LLM-as-judge prompt construction"]
        P3["LLM call (Bedrock/OpenAI)"]
        P4["Score parsing & structuring"]
        P5["Metric definitions & prompt templates"]
    end

    C4 -- "session data" --> P1
    P4 -- "structured scores" --> C5

    style CLOJURE fill:#ddf,stroke:#336
    style PYTHON fill:#dfd,stroke:#363
```

## 5. Data Model — What Gets Stored

```mermaid
erDiagram
    EVAL_RUN ||--o{ EVAL_SCORE : contains
    EVAL_RUN {
        uuid run_id PK
        timestamp run_timestamp
        string region
        string org_id
        string org_name_hash
        int sessions_sampled
        int sessions_total_available
        string eval_model
        string eval_prompt_version
    }
    EVAL_SCORE {
        uuid score_id PK
        uuid run_id FK
        string session_id
        string agent_type
        string metric_name
        float score
        string[] tool_names
        int message_count
        int tool_call_count
        timestamp session_timestamp
    }

    EVAL_METRIC ||--o{ EVAL_SCORE : defines
    EVAL_METRIC {
        string metric_name PK
        string description
        float min_value
        float max_value
        string eval_prompt_template
    }
```

## 6. Grafana Dashboard Layout

```mermaid
graph LR
    subgraph DASH["Grafana Dashboard: LLM Evaluation Scores"]
        subgraph TOPROW[" "]
            direction LR
            subgraph FILTERS["🔽 Top-Level Filters"]
                F1["Organisation"]
                F2["Region"]
                F3["Time Range"]
                F4["Agent Type"]
            end

            subgraph ROW1["Row 1: Overview"]
                P1["📊 Overall Score<br/>Time Series"]
                P2["📊 Score by Metric<br/>Stacked Bar"]
                P3["🔢 Stat Panels<br/>Avg, total, count"]
            end
        end

        subgraph BOTTOMROW[" "]
            direction LR
            subgraph ROW2["Row 2: Breakdown"]
                P4["📊 Score by Org<br/>Heatmap / Bar"]
                P5["📊 Score by Region<br/>Bar Chart"]
                P6["📊 Score by Agent Type<br/>Bar Chart"]
            end

            subgraph ROW3["Row 3: Details"]
                P7["📊 Score Distribution<br/>Histogram"]
                P8["📋 Tool vs Score<br/>Correlation Table"]
                P9["📊 Low-Score Sessions<br/>ID Table"]
            end
        end
    end

    FILTERS --- ROW1
    ROW2 --- ROW3
    TOPROW --> BOTTOMROW

    style FILTERS fill:#ffd,stroke:#333
    style ROW1 fill:#ddf,stroke:#333
    style ROW2 fill:#dfd,stroke:#333
    style ROW3 fill:#fdd,stroke:#333
    style TOPROW fill:none,stroke:none
    style BOTTOMROW fill:none,stroke:none
```

## 7. Deployment: ai_observability In-Region

```mermaid
graph TB
    subgraph CURRENT["Current State"]
        direction LR
        HQ_NOW["HQ (eu-north-1)"]
        HQ_OBSV["ai_observability ✅"]
        HQ_NOW --- HQ_OBSV

        PROD_NOW["production (eu-west-1)"]
        PROD_NO["ai_observability ❌"]
        PROD_NOW --- PROD_NO
    end

    subgraph TARGET["Target State"]
        direction LR
        HQ_T["HQ (eu-north-1)"]
        HQ_OBSV_T["ai_observability ✅"]
        HQ_T --- HQ_OBSV_T

        PROD_T["production (eu-west-1)"]
        PROD_OBSV["ai_observability ✅<br/>(eval endpoint)"]
        PROD_T --- PROD_OBSV

        US_T["us1 (us-east-1)"]
        US_OBSV["ai_observability ✅<br/>(eval endpoint)"]
        US_T --- US_OBSV

        OTHER_T["au / uae / ca"]
        OTHER_OBSV["ai_observability ✅"]
        OTHER_T --- OTHER_OBSV
    end

    CURRENT --> TARGET

    style CURRENT fill:#fdd,stroke:#c33
    style TARGET fill:#dfd,stroke:#3c3
```
