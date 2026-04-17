---
tags: [architecture, evaluation, llm, observability, privacy]
type: work
status: in-progress
---

# LLM Evaluation Pipeline - Architecture

## Problem

We need ongoing evaluation of LLM quality on real customer interactions, but cannot store raw inputs/outputs (sensitive data). We need a system that:

- Evaluates real customer sessions using LLM-as-a-judge
- Stores only aggregated/anonymised scores
- Visualises results in Grafana with org-level filtering
- Respects data sovereignty (customer data stays in-region)

## Constraints

| Constraint | Implication |
|---|---|
| No raw data storage | Only scores, metrics, metadata, and IDs leave the evaluation pipeline |
| Data sovereignty | Customer data must not cross region boundaries — eval must happen in-region |
| Customer consent | Orgs must opt in before their sessions are evaluated |
| Grafana in HQ | Aggregated scores must reach HQ (eu-north-1) for dashboarding |
| Minimal infra overhead | Prefer leveraging existing services over new deployments |

## Architecture Decision: In-Region Evaluation via Python

**Key insight**: Each customer region already has access to LLMs (AWS Bedrock + Azure OpenAI). By running evaluation _within_ the customer region, raw session data never crosses a region boundary. Only aggregated scores are sent to HQ.

**Approach**: Clojure (ardoq-api) handles scheduling, session selection, and data access. Python (ai_observability) handles all evaluation logic — LLM-as-judge prompt construction, LLM calls, score parsing, and metric definitions. Clojure calls the ai_observability `POST /eval/session` endpoint for each session.

This gives us:
- Clean separation: Clojure owns data, Python owns eval logic
- Fast iteration on eval prompts (Python, not Clojure)
- Reuse of existing ai_observability patterns and infrastructure
- Data sovereignty preserved — raw data stays in-region

### Prerequisite: Deploy ai_observability to Customer Regions

ai_observability currently runs in HQ only. For this pipeline, it must be deployed to each customer region (production, us1, au, uae, ca). This may be a lightweight deployment — only the eval endpoint needs to be available, not the full observability stack.

### What crosses the region boundary

Only this data leaves the customer region:

```
- org_id (string)
- region (string)
- session_id (string — opaque identifier)
- agent_type (string)
- metric_name (string — e.g. "relevance", "accuracy")
- score (float — 0.0 to 1.0)
- tool_names (string[] — which tools were used)
- message_count (int)
- tool_call_count (int)
- timestamp (datetime)
- eval_model (string — which model judged)
- eval_prompt_version (string — for reproducibility)
```

No message content, no user queries, no LLM responses, no tool arguments or results.

### What stays in-region

- Full session transcripts
- User prompts and LLM responses
- Tool call arguments and results
- Any PII or customer-specific content

---

## Component Responsibilities

### ardoq-api (Clojure)

- **Nightly CronJob**: K8s CronJob triggers the eval pipeline
- **Org selection**: Query orgs with `ai_eval_enabled = true`
- **Session sampling**: Randomly select N recent completed sessions per org
- **Session fetch**: Load full session data (messages, tool calls, results)
- **API call**: Send session data to ai_observability `POST /eval/session`
- **Aggregation**: Collect scores, compute per-org aggregates (mean, median, p95)
- **Storage**: Push aggregated scores to HQ Redshift
- **Cleanup**: Discard all raw session data after scoring

### ai_observability (Python)

- **Eval endpoint**: `POST /eval/session` — accepts session data, returns scores
- **Prompt templates**: LLM-as-judge prompt construction per metric
- **LLM interaction**: Call Bedrock/OpenAI for evaluation
- **Score parsing**: Extract structured scores from LLM response
- **Metric registry**: Define available metrics, scales, and prompt versions

---

## Open Questions

### Legal / Compliance

1. **Is org_id + session_id considered PII?** If so, we may need to hash or drop them. Session IDs are useful for debugging low scores but could be considered linkable.
2. **Is opt-in sufficient, or do we need explicit contractual agreement?** Some customers may have DPAs (Data Processing Agreements) that restrict automated analysis.
3. **Can we store tool_names?** Tool names like "search_components" are generic, but worth confirming.
4. **Retention policy** — how long do we keep aggregated scores?

### Cross-Region Orgs

5. **Can one customer belong to multiple regions?** If yes, we need to handle cross-region score aggregation in Grafana (filter by org across regions). The org_id should be consistent across regions for this to work.

### Sampling

6. **How many sessions per org per night?** Suggestion: start with 10-20 sessions per org, configurable. Too few = noisy signal, too many = cost.
7. **Selection criteria** — only completed sessions? Minimum message count? Exclude very short sessions?

### Deployment

8. **ai_observability in customer regions** — what's the effort to deploy? Can we do a minimal deployment with just the eval endpoint?
9. **Network path** — can ardoq-api pods reach ai_observability pods within the same region? Same namespace or cross-namespace?

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│ Customer Region (e.g. production, eu-west-1)                │
│                                                             │
│  K8s CronJob (02:00 UTC)                                    │
│       │                                                     │
│       ▼                                                     │
│  ardoq-api (Clojure)                                        │
│       │                                                     │
│       ├── SELECT opted-in orgs ──► RDS PostgreSQL            │
│       │                                                     │
│       ├── SELECT random sessions ──► RDS PostgreSQL          │
│       │                                                     │
│       ├── POST /eval/session ──► ai_observability (Python)   │
│       │                              │                      │
│       │                              ├── Build judge prompt  │
│       │                              ├── Call LLM            │
│       │                              └── Return scores       │
│       │                                                     │
│       ├── Aggregate scores per org                           │
│       │                                                     │
│       └── Push scores ──────────────────────────────────────┼──► HQ Redshift
│                                                             │
│  ⚠️  Raw session data NEVER leaves this box                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Eval Endpoint Contract

### Request: `POST /eval/session`

```json
{
  "session_id": "abc-123",
  "org_id": "org-456",
  "agent_type": "chat",
  "messages": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "...", "tool_calls": [...]},
    {"role": "tool", "content": "..."}
  ],
  "tool_names": ["search_components", "get_references"],
  "metrics": ["relevance", "accuracy", "helpfulness"]
}
```

### Response

```json
{
  "session_id": "abc-123",
  "eval_model": "claude-sonnet-4-20250514",
  "eval_prompt_version": "v1.2",
  "scores": [
    {"metric": "relevance", "score": 0.85},
    {"metric": "accuracy", "score": 0.92},
    {"metric": "helpfulness", "score": 0.78}
  ],
  "metadata": {
    "message_count": 12,
    "tool_call_count": 5
  }
}
```

Note: The response contains **no raw session content** — only scores, IDs, and metadata. Clojure can safely forward this to HQ.

---

## Storage: Redshift (Recommended)

HQ already has Redshift for analytics. Eval scores are analytical data — fits naturally.

- Create `llm_eval_runs` and `llm_eval_scores` tables in Redshift
- Grafana already connects to Redshift in HQ
- Good for time-series aggregation queries
- dbt can model derived metrics (rolling averages, percentiles)

### Why not alternatives?

| Option | Verdict |
|---|---|
| Dedicated PostgreSQL in HQ | Adds another database to manage; Redshift is already there |
| Prometheus + Pushgateway | Poor for ad-hoc queries, table views, per-session metadata |
| InfluxDB / TimescaleDB | New infra; overkill for this volume |

---

## Evaluation Metrics

Suggested initial metrics for LLM-as-judge:

| Metric | Description | Scale |
|---|---|---|
| **relevance** | Did the agent's responses address the user's actual question/intent? | 0.0–1.0 |
| **accuracy** | Were factual claims about Ardoq data correct? | 0.0–1.0 |
| **helpfulness** | Did the session move the user toward their goal? | 0.0–1.0 |
| **tool_appropriateness** | Were the right tools selected for the task? | 0.0–1.0 |
| **safety** | Did the agent avoid harmful, misleading, or out-of-scope responses? | 0.0–1.0 |
| **completeness** | Did the agent fully address the request or leave gaps? | 0.0–1.0 |

Each metric gets its own LLM-as-judge prompt template. Version the prompts — store `eval_prompt_version` with each score so we can track metric drift when prompts change.

---

## Opt-In Mechanism

1. Add `ai_eval_enabled` boolean to org configuration in ardoq-api
2. Default: `false` (opt-in, not opt-out)
3. Configurable via backoffice or API
4. Nightly job checks this flag before selecting sessions from an org
5. Consider a `ai_eval_sample_rate` field (e.g. 0.1 = 10% of sessions) for large orgs

---

## Implementation Phases

### Phase 1: Foundation

- [ ] Legal review: confirm what metadata is permissible
- [ ] Add `ai_eval_enabled` flag to org config (Clojure)
- [ ] Deploy ai_observability to at least one customer region (production)
- [ ] Implement `POST /eval/session` endpoint in ai_observability
- [ ] Write LLM-as-judge prompt templates (start with 2-3 metrics)
- [ ] Create `llm_eval_runs` + `llm_eval_scores` tables in Redshift
- [ ] Implement nightly job in Clojure (CronJob + session selection + API call)
- [ ] Push scores to Redshift

### Phase 2: Dashboard

- [ ] Create Grafana dashboard with org/region/time filters
- [ ] Time series: overall score trends
- [ ] Breakdown panels: by org, region, agent type, metric
- [ ] Distribution histograms
- [ ] Low-score session table (IDs only, for investigation)

### Phase 3: Expand & Iterate

- [ ] Deploy ai_observability to remaining customer regions (us1, au, uae, ca)
- [ ] Add more evaluation metrics
- [ ] Tune sampling strategy (session count, selection criteria)
- [ ] Add tool-usage correlation analysis
- [ ] Alert on score degradation (Grafana alerts)
- [ ] dbt models for rolling averages, percentiles, trend detection

---

## Related

- [[2026-04-13 LLM Evaluation Pipeline - Visual]] — Mermaid diagrams
- Infrastructure context: [[Infrastructure/Architecture - Explained]] — region isolation model
- Eval code: `projects/ai_observability/` in devops-monorepo
