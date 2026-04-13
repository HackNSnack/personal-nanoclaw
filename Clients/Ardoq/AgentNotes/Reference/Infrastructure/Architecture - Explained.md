---
tags: [infrastructure, architecture, documentation]
type: reference
status: done
---

# Ardoq Infrastructure Architecture - Detailed Explanation

## Overview

Ardoq runs a **multi-region, multi-cloud SaaS platform** where each geographic region gets a fully isolated infrastructure stack. The primary platform runs on AWS with Azure serving as a secondary backup destination and AI services provider. Infrastructure is managed via Terraform (OpenTofu), Ansible, and Helmfile.

---

## 1. Regional Environment Model

### How Regions Work

Each customer-facing region is a **complete, independent deployment** of the entire Ardoq stack. There is no shared compute, database, or cache between regions. This provides:

- **Data sovereignty** — customer data never leaves the region
- **Blast radius containment** — an outage in one region cannot affect another
- **Independent scaling** — each region scales to its own demand

### Current Regions

| Environment | Cloud | AWS Region | Domain | Purpose |
|---|---|---|---|---|
| **production** | AWS | eu-west-1 (Ireland) | `*.ardoq.com` | EU customers (primary) |
| **us1** | AWS | us-east-1 (Virginia) | `*.us.ardoq.com` | US customers |
| **au** | AWS | ap-southeast-2 (Sydney) | `*.au.ardoq.com` | Australia customers |
| **uae** | AWS | me-central-1 (UAE) | `*.uae.ardoq.com` | UAE customers |
| **ca** | AWS | ca-central-1 (Canada) | `*.ca.ardoq.com` | Canada customers |
| **test** | AWS | eu-central-1 (Frankfurt) | `test.ardoq.com` | Testing + internal dev envs |
| **standby** | AWS | eu-west-3 (Paris) | — | Disaster recovery for production |
| **hq** | AWS | eu-north-1 (Stockholm) | `hq.ardoq.com` | Internal operations, CI/CD, analytics |

### Azure Environments (Secondary)

Azure environments (`az_production`, `az_us1`, `az_au`, `az_uae`, `az_ca`, `az_test`) serve primarily as **secondary backup destinations**. Each AWS region has a paired Azure environment for cross-cloud disaster recovery. Additionally, some regions (`az-us2`, `az-uae`) run AKS clusters for Azure-native customers.

Azure OpenAI is used across regions for LLM inference capabilities.

---

## 2. What Each Region Contains

Every customer-facing region provisions an identical set of infrastructure components through shared Terraform modules:

### Networking
- **VPC** with `10.0.0.0/16` CIDR, spanning 3 availability zones
- **Public subnets** — NAT gateways, bastion host
- **Private subnets** — EKS nodes, RDS, ElastiCache (no direct internet access)
- **Security groups** — per-service (RDS, Redis, bastion, K8s, monitoring)

### Compute (Kubernetes)
- **EKS cluster** (v1.35) with OIDC provider for IRSA
- **4-5 node groups** separated by workload type (see section 4)
- **Karpenter** auto-scaler for dynamic node provisioning
- **ingress-nginx** as the API gateway (NodePort 32080/32443)

### Data
- **RDS PostgreSQL 17** — single instance per region, Multi-AZ, encrypted at rest and in transit
- **ElastiCache Redis** (or Valkey) — Multi-AZ, encrypted, auth token with rotation
- **NATS** — message broker for async communication (3-node cluster)
- **S3 buckets** — attachments, audit logs, JFR recordings, backups

### Security & Traffic
- **AWS WAF v2** — OWASP managed rules, host-based filtering, rate limiting, IP reputation
- **CloudFront** — CDN for static assets
- **ALB** — application load balancer behind WAF
- **SES** — email sending via multitenant mail service
- **Bastion host** — SSH jump server for operator access

### Monitoring
- **ELK stack** (Elasticsearch, Kibana, Logstash) via dedicated monitoring instance
- **Filebeat, Metricbeat, Auditbeat** — log and metrics collection
- **OpenTelemetry collector** — distributed tracing
- **Falco** — runtime security monitoring
- **Trivy** — container image vulnerability scanning

---

## 3. Customer & Tenant Isolation

Ardoq uses a **layered isolation model** with four levels:

### Level 1: Region Isolation (Strongest)

Customers are assigned to a region based on geographic/regulatory requirements. Each region runs on completely separate AWS infrastructure — separate VPC, separate EKS cluster, separate RDS instance, separate S3 buckets. There is **zero shared compute or storage** between regions.

A customer in `us1` (us-east-1) has no network path to a customer in `production` (eu-west-1). This is enforced at the AWS account and network level.

### Level 2: Infrastructure-Level Isolation (Per Region)

Within a region, all customers share the same infrastructure stack but are isolated through:

- **Dedicated database instance** — one RDS PostgreSQL per region (not per customer)
- **Dedicated cache instance** — one Redis/Valkey cluster per region
- **WAF host filtering** — only allows requests matching the region's domain pattern (e.g., `^([a-zA-Z0-9-_]+\.)?ardoq\.com$` for production)
- **Separate S3 buckets** — attachments and audit logs per region

### Level 3: Application-Level Multi-Tenancy

Within a shared regional deployment, customer separation is handled at the application layer:

- **Organization IDs** — each customer is an "organization" in the Ardoq data model
- **Database users** — separate PostgreSQL roles for different services (`ardoq_api_user`, `ardoq_customers_user`, `ardoq_grl_user`, `ardoq_shiftx_user`, `ardoq_cdc_user`), each with scoped permissions
- **Multitenant mail** — email routing per organization with BYOD (Bring Your Own Domain) support
- **Per-org audit logs** — stored in S3

### Level 4: Kubernetes Workload Isolation

Pods are segregated by function through node groups and namespaces (see section 4). IRSA (IAM Roles for Service Accounts) ensures each Kubernetes service account has least-privilege AWS access.

### Key Insight

Ardoq is **single-tenant at the infrastructure level** (one stack per region) but **multi-tenant at the application level** (multiple customer orgs share that stack). This means a new geographic region requires provisioning an entirely new environment, but onboarding a new customer within an existing region is purely an application-layer operation.

---

## 4. Kubernetes Architecture

### Node Group Strategy

Each EKS cluster partitions nodes into workload-specific groups using Kubernetes labels. Pods are scheduled to the appropriate group via `nodeSelector: workload: <type>`:

| Node Group | Label | Instance Types | Scaling | What Runs Here |
|---|---|---|---|---|
| **main** | `workload: main` | m6g.2xlarge, m7g.2xlarge | 3–15 nodes | ardoq-api, ardoq-front, ardoq-login, ardoq-discover, ardoq-backoffice |
| **graph** | `workload: graph` | m6g.4xlarge, m7g.4xlarge | up to 85 nodes | Graph query services (heavy compute) |
| **data** | `workload: data` | m6g.xlarge, m6g.2xlarge | 3–9 nodes | PostgreSQL pods, Valkey/Redis, NATS, ardoq-cdc |
| **ops** | `workload: ops` | m6g.2xlarge | 3–10 nodes | ingress-nginx, Karpenter, backups, mail, monitoring agents |
| **internal-env** | `workload: internal-env` | m6g.2xlarge, m7g.2xlarge | 1–30 nodes | Internal development environments (test cluster only) |

This prevents noisy-neighbor problems — a heavy graph query cannot starve the API or data layer.

### Namespace Layout

```
webapps      — Frontend (ardoq-front, ardoq-process, ardoq-surveys)
services     — Core API and business logic
graph        — Graph database services
data         — Data stores and CDC
network      — ingress-nginx controller
operations   — Backup jobs, Karpenter, multitenant-mail
monitoring   — ELK operator, Beats, OpenTelemetry, Falco
ai           — GPU workloads, LLM proxies (HQ only)
```

### Pod Scheduling

- **Priority classes**: `critical-services-priority` > `data-priority` > `daemonset-priority`
- **Anti-affinity**: Critical services (ardoq-front, ingress-nginx) spread across nodes
- **Karpenter**: Dynamically provisions nodes based on pending pod demand

### IRSA (IAM Roles for Service Accounts)

Each Kubernetes service account maps to a specific AWS IAM role via OIDC federation. This means:
- The ardoq-api pod can access the attachments S3 bucket but not the audit log bucket
- The backup pod can write to the backup S3 bucket but not the production database
- Internal environment pods have their own restricted IAM user

---

## 5. Internal Environments (Test Cluster)

The test environment (`eu-central-1`) supports a unique feature: **14 isolated internal development environments** running on a shared EKS cluster. These are used by Ardoq's development teams.

### How They Work

Each internal environment (e.g., `qa`, `devops`, `core`, `ai`, `process`) gets:

1. **Dedicated DNS** — `*.{name}.ardoq.dev` (e.g., `*.qa.ardoq.dev`)
2. **Dedicated TLS certificate** — ACM cert with DNS validation
3. **Dedicated ALB listener rule** — host-based routing from the shared ALB
4. **Dedicated S3 bucket** — `ardoq-test-internal-env-{name}-attachments`
5. **Dedicated database connection pool** — separate pool sizes per env
6. **Shared node group** — all internal envs schedule onto `workload: internal-env` nodes

### Internal Environments List

`qa`, `devops`, `core`, `process`, `ai`, `appsec`, `impact`, `impact2`, `insight`, `integrations`, `interns`, `partners`, `engagement`, `security`

### Provisioning

Internal environments are created via Terraform's `for_each` over a list:

```hcl
module "internal_env" {
  for_each = toset(local.internal_envs_list)
  source   = "../../modules/ardoq_internal_env"
  prefix   = "test"
  name     = each.key
}
```

The `ardoq_internal_env` module handles DNS, TLS, ALB routing, S3 bucket, and IAM configuration per environment.

### How This Differs from Customer Regions

| Aspect | Customer Region | Internal Environment |
|---|---|---|
| EKS Cluster | Dedicated | Shared (test cluster) |
| RDS Instance | Dedicated | Shared (test RDS) |
| Node Group | All workload types | Shared `internal-env` pool |
| DNS | `*.{region}.ardoq.com` | `*.{team}.ardoq.dev` |
| WAF | Dedicated rules | Shared test WAF |
| S3 | Dedicated buckets | Per-env attachments bucket |
| Purpose | Production customer traffic | Developer testing |

---

## 6. Backup & Disaster Recovery

### Backup Strategy

Each region implements multiple backup layers:

1. **Full backup** (`ardoq-backup-full-backup`) — complete system snapshot, replicated to paired region
2. **Org sync backup** (`ardoq-backup-org-sync-backup`) — organization metadata synced to global S3 bucket
3. **Customer org sync** (`ardoq-backup-customer-org-sync-backup`) — per-customer organization data with dedicated IRSA roles
4. **Source code backup** (`ardoq-backup-source-code`) — repository backups
5. **Secondary backup** — cross-cloud to paired Azure environment

### Disaster Recovery

- **Standby environment** (eu-west-3) is a warm standby for production (eu-west-1)
- Full restore capability via `ardoq-backup-full-restore` (disabled by default, manual trigger)
- Global customer org sync bucket enables cross-region data migration
- Azure secondary backups provide cross-cloud resilience

### Cross-Region Data Flow

The **global customer org sync bucket** (`ardoq-customer-org-sync` in eu-west-1) acts as a central hub:
- Each region has a **writer** service account that pushes customer org data
- Each region has a **reader** service account that can pull data for restoration
- Uses IRSA for secure, least-privilege access

---

## 7. HQ Environment (Special Purpose)

The HQ environment (`eu-north-1`) differs significantly from customer regions. It serves as Ardoq's internal operations hub:

### Unique Components

- **ArgoCD** — GitOps deployment engine for internal services
- **Redshift** — data warehouse for analytics
- **Superset / dbt** — BI dashboards and data transformations
- **Argo Workflows** — data pipeline orchestration
- **SIEM** — security information and event management
- **AI/ML stack** — NVIDIA GPU nodes, KubeAI, LiteLLM, AI agents (m6g.2xlarge)
- **Sentry** — error tracking (test + production instances)
- **1Password SCIM** — identity management
- **OpenCost** — cost analysis

HQ does **not** run customer workloads. It uses a community VPC module instead of the custom `ardoq_vpc`, and has no RDS or ElastiCache (no customer data).

---

## 8. Multi-Cloud Strategy

### AWS (Primary)
All customer-facing infrastructure runs on AWS. Each region is a full AWS deployment with EKS, RDS, ElastiCache, S3, WAF, CloudFront, SES, and Bedrock.

### Azure (Secondary)
Azure serves three purposes:

1. **Secondary backup** — each AWS region backs up to a paired Azure environment via `az_secondary_backup` module
2. **Azure OpenAI** — LLM inference for AI features (accessed from all regions via `converged_openai_deployment` module)
3. **Azure-native regions** — `az-us2` and `az-uae` run AKS clusters for customers requiring Azure hosting

Azure environments use:
- AKS with node pools mirroring AWS pattern (main, graph, ops, data, ai)
- Azure PostgreSQL Flexible Server with Private Link
- Azure Redis with private endpoints
- Application Gateway with WAF
- Azure Sentinel for security monitoring

---

## 9. Traffic Flow (End to End)

A customer request follows this path:

1. **DNS** — `customer.ardoq.com` resolves to CloudFront distribution
2. **CloudFront** — caches static assets, forwards dynamic requests
3. **WAF** — validates host header matches region pattern, applies OWASP rules, rate limiting, IP reputation checks
4. **ALB** — routes to EKS node port (32080/32443)
5. **ingress-nginx** — Kubernetes ingress controller, applies per-customer rate limits (bypass list for specific customers like `tine.ardoq.com`, `orbis.ardoq.com`)
6. **Pod** — request hits ardoq-api (or other service) in the appropriate namespace
7. **Database** — ardoq-api queries RDS PostgreSQL (private subnet, encrypted)
8. **Cache** — Redis/Valkey for session/cache data
9. **S3** — attachments read/write via IRSA-authenticated API calls

### Rate Limiting

Nginx applies multiple rate limit zones:
- `token_plus_uri_limit`: 30 req/min per token+URI combination
- `token_limit`: 50 req/sec per auth token
- `queue3_limit`: 2 req/min for heavy endpoints
- Certain customers have bypass rules for higher limits

---

## 10. Infrastructure as Code Organization

### Terraform

```
terraform/
├── live/           # Per-environment configurations
│   ├── production/ # main.tf, variables.tf, terraform.tfvars, outputs.tf
│   ├── us1/
│   ├── au/
│   ├── ...
│   └── global/     # Cross-region resources (org sync bucket)
└── modules/        # 54 reusable modules
    ├── ardoq_*     # AWS modules
    ├── az_*        # Azure modules
    └── ...         # Utility modules
```

Each environment's `main.tf` composes modules to build the full stack. New regions are created by copying an environment directory and adjusting `terraform.tfvars` (region, prefix, domain, sizing).

### Helm

```
helm/
├── live/           # Per-environment helmfiles
│   ├── production/
│   ├── test/
│   │   └── internal-env/  # Per-team value overrides
│   └── hq/
│       ├── data-ops/
│       ├── it-ops/
│       └── observability/
└── values/         # Shared chart values (50+ services)
```

Helmfile composes values in order: global defaults → chart values → environment overrides → SOPS secrets.

### Ansible

```
inventory/          # Per-environment host definitions
configuration/      # Playbooks and roles (ELK, bastion, SSH management)
secrets/            # SOPS-encrypted per-environment secrets
```

---

## Summary

Ardoq's infrastructure follows a **region-isolated, infrastructure-separated, application-multi-tenant** model:

- **Regions are fully isolated** — separate VPC, cluster, database, cache, storage
- **Within a region, customers share infrastructure** — one EKS cluster, one RDS, one Redis
- **Customer separation is application-level** — organization IDs, database roles, API authorization
- **Workload types are node-isolated** — dedicated node groups prevent resource contention
- **Internal dev environments** use a lightweight isolation model on the test cluster
- **Disaster recovery** spans both cross-region (AWS standby) and cross-cloud (Azure backup)
- **HQ is a separate operations hub** with analytics, CI/CD, security, and AI capabilities
