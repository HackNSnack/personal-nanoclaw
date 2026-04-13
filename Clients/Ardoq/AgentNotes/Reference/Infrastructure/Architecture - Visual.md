---
tags: [infrastructure, architecture, visualization, mermaid]
type: reference
status: done
---

# Ardoq Infrastructure Architecture - Visual Guide

## 1. Global Multi-Region Overview

```mermaid
graph TB
    subgraph "Ardoq Global Infrastructure"
        direction TB

        subgraph GLOBAL["AWS Global (eu-west-1)"]
            G_S3[("Customer Org Sync\nS3 Bucket")]
            G_STATE[("Terraform State\n(shared)")]
        end

        subgraph EU_PROD["Production (eu-west-1)"]
            P_VPC["VPC 10.0.0.0/16"]
            P_EKS["EKS Cluster v1.35"]
            P_RDS[("RDS PostgreSQL 17\ndb.m8g.4xlarge\n1TB")]
            P_REDIS[("ElastiCache Redis\ncache.m6g.large")]
            P_S3[("S3 Attachments")]
            P_WAF["WAF\n*.ardoq.com"]
            P_CF["CloudFront CDN"]
        end

        subgraph US["US1 (us-east-1)"]
            U_VPC["VPC"]
            U_EKS["EKS Cluster v1.35"]
            U_RDS[("RDS PostgreSQL 17\ndb.m8g.4xlarge\n400GB")]
            U_REDIS[("ElastiCache Redis")]
            U_WAF["WAF\n*.us.ardoq.com"]
        end

        subgraph AU["AU (ap-southeast-2)"]
            A_VPC["VPC"]
            A_EKS["EKS Cluster v1.35"]
            A_RDS[("RDS PostgreSQL 17")]
            A_REDIS[("ElastiCache Redis")]
            A_WAF["WAF\n*.au.ardoq.com"]
        end

        subgraph UAE["UAE (me-central-1)"]
            AE_VPC["VPC"]
            AE_EKS["EKS Cluster v1.35"]
            AE_RDS[("RDS PostgreSQL 17")]
            AE_REDIS[("ElastiCache Redis")]
            AE_WAF["WAF\n*.uae.ardoq.com"]
        end

        subgraph CA["CA (ca-central-1)"]
            CA_VPC["VPC"]
            CA_EKS["EKS Cluster v1.35"]
            CA_RDS[("RDS PostgreSQL 17")]
            CA_REDIS[("ElastiCache Redis")]
            CA_WAF["WAF\n*.ca.ardoq.com"]
        end

        subgraph TEST["Test (eu-central-1)"]
            T_VPC["VPC"]
            T_EKS["EKS Cluster v1.35"]
            T_RDS[("RDS PostgreSQL 17")]
            T_INTERNAL["Internal Envs\n(14 isolated workspaces)"]
            T_WAF["WAF\ntest.ardoq.com\n*.ardoq.dev"]
        end

        subgraph HQ["HQ (eu-north-1)"]
            H_VPC["VPC"]
            H_EKS["EKS Cluster"]
            H_REDSHIFT[("Redshift\nAnalytics")]
            H_ARGOCD["ArgoCD"]
            H_SIEM["SIEM"]
            H_AI["AI Agents"]
        end

        subgraph DR["Standby / DR (eu-west-3)"]
            DR_VPC["VPC"]
            DR_EKS["EKS Cluster"]
            DR_RDS[("RDS (restore-ready)")]
        end

        subgraph AZURE["Azure (Secondary)"]
            AZ_PROD["az_production"]
            AZ_US1["az_us1"]
            AZ_AU["az_au"]
            AZ_UAE["az_uae"]
            AZ_OPENAI["Azure OpenAI"]
        end
    end

    EU_PROD -- "backup replication" --> DR
    EU_PROD -- "org sync" --> G_S3
    US -- "org sync" --> G_S3
    AU -- "org sync" --> G_S3
    UAE -- "org sync" --> G_S3
    CA -- "org sync" --> G_S3
    EU_PROD -- "secondary backup" --> AZ_PROD
    US -- "secondary backup" --> AZ_US1
    AU -- "secondary backup" --> AZ_AU
    UAE -- "secondary backup" --> AZ_UAE
    EU_PROD -- "LLM requests" --> AZ_OPENAI
    US -- "LLM requests" --> AZ_OPENAI

    style GLOBAL fill:#f9f,stroke:#333
    style EU_PROD fill:#bbf,stroke:#333
    style DR fill:#fbb,stroke:#333
    style AZURE fill:#bfb,stroke:#333
    style HQ fill:#fbf,stroke:#333
    style TEST fill:#ffb,stroke:#333
```

## 2. Single Environment Architecture (Per Region)

```mermaid
graph TB
    subgraph ENV["Environment (e.g. production / eu-west-1)"]
        INTERNET((Internet))

        subgraph PUB["Public Zone"]
            CF["CloudFront CDN"]
            WAF["AWS WAF v2\nOWASP rules\nHost filtering\nRate limiting"]
            ALB["Application\nLoad Balancer"]
        end

        subgraph VPC["VPC (10.0.0.0/16)"]
            subgraph PUB_SUB["Public Subnets (3 AZs)"]
                BASTION["Bastion Host\n(SSH jump)"]
                NAT["NAT Gateways"]
            end

            subgraph PRIV_SUB["Private Subnets (3 AZs)"]
                subgraph EKS["EKS Cluster"]
                    NG_MAIN["Node Group: main\nm6g/m7g.2xlarge\n3-15 nodes"]
                    NG_GRAPH["Node Group: graph\nm6g/m7g.4xlarge\nup to 85 nodes"]
                    NG_DATA["Node Group: data\nm6g.xlarge/2xlarge\n3-9 nodes"]
                    NG_OPS["Node Group: ops\nm6g.2xlarge\n3-10 nodes"]
                    KARPENTER["Karpenter\nAuto-scaler"]
                end

                RDS[("RDS PostgreSQL 17\nMulti-AZ\nEncrypted")]
                REDIS[("ElastiCache Redis\nMulti-AZ\nEncrypted")]
            end
        end

        subgraph S3_ZONE["S3 Storage"]
            S3_ATTACH[("Attachments\nBucket")]
            S3_AUDIT[("Audit Logs\nBucket")]
            S3_JFR[("JFR Recordings\nBucket")]
            S3_BACKUP[("Backup\nBucket")]
        end

        SES["SES\n(Email)"]
        BEDROCK["AWS Bedrock\n(LLM)"]
        MONITORING["ELK Stack\n(Monitoring)"]
    end

    INTERNET --> CF --> WAF --> ALB
    ALB --> NG_MAIN
    ALB --> NG_OPS
    BASTION --> EKS
    BASTION --> RDS
    NG_MAIN --> RDS
    NG_MAIN --> REDIS
    NG_DATA --> RDS
    NG_DATA --> REDIS
    EKS --> S3_ATTACH
    EKS --> SES
    EKS --> BEDROCK
    EKS --> MONITORING

    style PUB fill:#ffd,stroke:#333
    style PRIV_SUB fill:#ddf,stroke:#333
    style S3_ZONE fill:#dfd,stroke:#333
```

## 3. Kubernetes Workload Isolation (Node Groups)

```mermaid
graph LR
    subgraph EKS["EKS Cluster"]
        subgraph NG_MAIN["workload: main"]
            NS_WEB["namespace: webapps\n─────────────\nardoq-front\nardoq-process\nardoq-surveys"]
            NS_SVC["namespace: services\n─────────────\nardoq-api\nardoq-login\nardoq-backoffice\nardoq-discover\nardoq-mcp"]
        end

        subgraph NG_GRAPH["workload: graph"]
            NS_GRAPH["namespace: graph\n─────────────\ngraph services\n(heavy compute)"]
        end

        subgraph NG_DATA["workload: data"]
            NS_DATA["namespace: data\n─────────────\nPostgreSQL (pods)\nValkey/Redis\nNATS broker\nardoq-cdc"]
        end

        subgraph NG_OPS["workload: ops"]
            NS_NET["namespace: network\n─────────────\ningress-nginx"]
            NS_OPS["namespace: operations\n─────────────\nKarpenter\nmultitenant-mail\nbackup jobs"]
            NS_MON["namespace: monitoring\n─────────────\nECK operator\nBeats agents\nOpenTelemetry\nFalco"]
        end

        subgraph NG_INTENV["workload: internal-env\n(test only)"]
            NS_INT1["qa.ardoq.dev"]
            NS_INT2["devops.ardoq.dev"]
            NS_INT3["core.ardoq.dev"]
            NS_INTN["... 11 more"]
        end
    end

    style NG_MAIN fill:#bbf,stroke:#333
    style NG_GRAPH fill:#fbf,stroke:#333
    style NG_DATA fill:#bfb,stroke:#333
    style NG_OPS fill:#ffb,stroke:#333
    style NG_INTENV fill:#fdb,stroke:#333
```

## 4. Customer & Tenant Isolation Model

```mermaid
graph TB
    subgraph ISOLATION["Ardoq Tenant Isolation Strategy"]
        direction TB

        subgraph L1["Level 1: Region Isolation"]
            R_EU["EU Customers\n→ production (eu-west-1)"]
            R_US["US Customers\n→ us1 (us-east-1)"]
            R_AU["AU Customers\n→ au (ap-southeast-2)"]
            R_UAE["UAE Customers\n→ uae (me-central-1)"]
            R_CA["CA Customers\n→ ca (ca-central-1)"]
        end

        subgraph L2["Level 2: Infrastructure Isolation (per region)"]
            I_VPC["Dedicated VPC"]
            I_EKS["Dedicated EKS Cluster"]
            I_RDS["Dedicated RDS Instance"]
            I_REDIS["Dedicated Redis Cluster"]
            I_S3["Dedicated S3 Buckets"]
            I_WAF["Dedicated WAF Rules"]
        end

        subgraph L3["Level 3: Application-Level Multi-Tenancy"]
            A_ORG["Organization IDs\n(logical separation)"]
            A_DB["Database Users\nardoq_api_user\nardoq_customers_user\nardoq_grl_user\nardoq_shiftx_user\nardoq_cdc_user"]
            A_MAIL["Multitenant Mail\n(per-org routing)"]
            A_AUDIT["Per-Org Audit Logs"]
        end

        subgraph L4["Level 4: K8s Workload Isolation"]
            K_NODE["Node Group Separation\n(main/graph/data/ops)"]
            K_NS["Namespace Boundaries"]
            K_IRSA["IRSA: Pod → IAM Role\n(least privilege)"]
            K_PRIO["Priority Classes\n(critical/data/daemonset)"]
        end
    end

    L1 --> L2
    L2 --> L3
    L3 --> L4

    style L1 fill:#fdd,stroke:#c33
    style L2 fill:#ffd,stroke:#cc3
    style L3 fill:#dfd,stroke:#3c3
    style L4 fill:#ddf,stroke:#33c
```

## 5. Internal Environments (Test Cluster)

```mermaid
graph TB
    subgraph TEST_CLUSTER["Test Environment (eu-central-1)"]
        ALB_TEST["ALB\n(Shared Load Balancer)"]

        subgraph ROUTING["Host-Based Routing"]
            R1["test.ardoq.com → main app"]
            R2["*.qa.ardoq.dev → QA env"]
            R3["*.devops.ardoq.dev → DevOps env"]
            R4["*.core.ardoq.dev → Core env"]
            R5["*.ai.ardoq.dev → AI env"]
            R6["... 10 more teams"]
        end

        subgraph SHARED_INFRA["Shared Infrastructure"]
            EKS_TEST["EKS Cluster"]
            RDS_SHARED["Shared RDS Instance"]
        end

        subgraph INT_ENV_POOL["Node Group: internal-env\nm6g/m7g.2xlarge, 1-30 nodes"]
            ENV_QA["QA\n──────\nDedicated namespace\nDedicated S3 bucket\nDedicated DNS record\nDedicated TLS cert\nSeparate DB connection pool"]
            ENV_DEVOPS["DevOps\n──────\n(same pattern)"]
            ENV_CORE["Core\n──────\n(same pattern)"]
            ENV_N["...\n──────\n14 total"]
        end
    end

    ALB_TEST --> ROUTING
    R1 --> EKS_TEST
    R2 --> ENV_QA
    R3 --> ENV_DEVOPS
    R4 --> ENV_CORE
    R5 --> ENV_N

    style INT_ENV_POOL fill:#fdb,stroke:#333
    style ROUTING fill:#ddf,stroke:#333
```

## 6. Backup & Disaster Recovery Flow

```mermaid
graph LR
    subgraph PRIMARY["Primary Regions (AWS)"]
        PROD["production\n(eu-west-1)"]
        US1["us1\n(us-east-1)"]
        AU1["au\n(ap-southeast-2)"]
        UAE1["uae\n(me-central-1)"]
    end

    subgraph DR_REGION["DR Region (AWS)"]
        STANDBY["standby\n(eu-west-3)"]
    end

    subgraph AZURE_BACKUP["Azure (Secondary Backup)"]
        AZ_P["az_production"]
        AZ_U["az_us1"]
        AZ_A["az_au"]
        AZ_AE["az_uae"]
    end

    subgraph GLOBAL_SYNC["Global (eu-west-1)"]
        ORG_SYNC[("Customer Org\nSync Bucket")]
    end

    PROD -- "full backup\nreplication" --> STANDBY
    PROD -- "secondary backup" --> AZ_P
    US1 -- "secondary backup" --> AZ_U
    AU1 -- "secondary backup" --> AZ_A
    UAE1 -- "secondary backup" --> AZ_AE

    PROD -- "org sync write" --> ORG_SYNC
    US1 -- "org sync write" --> ORG_SYNC
    AU1 -- "org sync write" --> ORG_SYNC
    UAE1 -- "org sync write" --> ORG_SYNC

    ORG_SYNC -- "org sync read\n(restore)" --> PROD
    ORG_SYNC -- "org sync read\n(restore)" --> US1

    style PRIMARY fill:#bbf,stroke:#333
    style DR_REGION fill:#fbb,stroke:#333
    style AZURE_BACKUP fill:#bfb,stroke:#333
    style GLOBAL_SYNC fill:#fbf,stroke:#333
```

## 7. DNS & Traffic Flow

```mermaid
graph TB
    subgraph DNS["DNS Routing"]
        D_MAIN["*.ardoq.com\n→ production (eu-west-1)"]
        D_US["*.us.ardoq.com\n→ us1 (us-east-1)"]
        D_AU["*.au.ardoq.com\n→ au (ap-southeast-2)"]
        D_UAE["*.uae.ardoq.com\n→ uae (me-central-1)"]
        D_CA["*.ca.ardoq.com\n→ ca (ca-central-1)"]
        D_TEST["test.ardoq.com\n→ test (eu-central-1)"]
        D_HQ["hq.ardoq.com\n→ hq (eu-north-1)"]
        D_DEV["*.ardoq.dev\n→ test internal envs"]
    end

    subgraph TRAFFIC["Traffic Path (per region)"]
        CF2["CloudFront"] --> WAF2["WAF\nHost validation\nOWASP rules\nRate limiting"]
        WAF2 --> ALB2["ALB"]
        ALB2 --> NGINX["ingress-nginx\n(NodePort 32080/32443)"]
        NGINX --> PODS["Application Pods"]
    end

    D_MAIN --> CF2
    D_US --> CF2
    D_AU --> CF2

    style DNS fill:#ffd,stroke:#333
    style TRAFFIC fill:#ddf,stroke:#333
```

## 8. Multi-Cloud Strategy

```mermaid
graph TB
    subgraph AWS_PRIMARY["AWS (Primary Platform)"]
        direction LR
        AWS_COMPUTE["EKS Clusters\n(all regions)"]
        AWS_DB["RDS PostgreSQL\n(per region)"]
        AWS_CACHE["ElastiCache Redis\n(per region)"]
        AWS_STORE["S3 Storage\n(per region)"]
        AWS_NET["VPC + WAF + CF\n(per region)"]
        AWS_BEDROCK["Bedrock\n(LLM)"]
        AWS_SES["SES\n(Email)"]
    end

    subgraph AZURE_SECONDARY["Azure (Secondary / DR + AI)"]
        direction LR
        AZ_BACKUP2["Backup Storage\n(per region pair)"]
        AZ_OPENAI2["Azure OpenAI\n(LLM inference)"]
        AZ_AKS2["AKS\n(az-us2, az-uae)"]
    end

    AWS_PRIMARY -- "secondary backup" --> AZ_BACKUP2
    AWS_PRIMARY -- "LLM inference" --> AZ_OPENAI2
    AZ_AKS2 -. "some regions\nrun on Azure" .-> AZURE_SECONDARY

    style AWS_PRIMARY fill:#ff9,stroke:#333
    style AZURE_SECONDARY fill:#9cf,stroke:#333
```

## 9. HQ Environment (Internal Operations)

```mermaid
graph TB
    subgraph HQ_ENV["HQ (eu-north-1) - Internal Operations"]
        subgraph DEPLOY["Deployment"]
            ARGOCD["ArgoCD\n(GitOps)"]
            ROLLOUTS["Argo Rollouts\n(Progressive delivery)"]
        end

        subgraph ANALYTICS["Analytics"]
            REDSHIFT[("Redshift\nData Warehouse")]
            DBT["dbt\n(Transforms)"]
            SUPERSET["Superset\n(Dashboards)"]
            ARGO_WF["Argo Workflows\n(Data pipelines)"]
        end

        subgraph SECURITY["Security"]
            SIEM["SIEM"]
            FALCO["Falco\n(Runtime)"]
            TRIVY["Trivy\n(Image scan)"]
        end

        subgraph AI_ML["AI / ML"]
            GPU["NVIDIA GPU Nodes"]
            KUBEAI["KubeAI"]
            LITELLM["LiteLLM\n(LLM Gateway)"]
            AGENTS["AI Agents\nm6g.2xlarge"]
        end

        subgraph OBSERVABILITY["Observability"]
            SENTRY["Sentry\n(Error tracking)"]
            PROM["Prometheus"]
            GRAFANA["Grafana"]
            OPENCOST["OpenCost"]
        end

        subgraph IT_OPS["IT Ops"]
            ONEPASS["1Password SCIM"]
        end
    end

    ARGOCD --> ANALYTICS
    ARGOCD --> AI_ML

    style HQ_ENV fill:#fbf,stroke:#333
    style DEPLOY fill:#bbf,stroke:#333
    style ANALYTICS fill:#bfb,stroke:#333
    style AI_ML fill:#ffb,stroke:#333
```
