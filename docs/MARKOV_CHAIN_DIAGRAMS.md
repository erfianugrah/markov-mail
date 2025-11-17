# Markov Chain Fraud Detection - Complete System Diagrams

**Version**: 2.5.0
**Last Updated**: 2025-11-17

This document provides comprehensive visual diagrams of the entire Markov Chain-based fraud detection system using mermaid notation.

---

## Table of Contents

1. [High-Level System Architecture](#1-high-level-system-architecture)
2. [Request Validation Flow](#2-request-validation-flow)
3. [Markov Chain Training Pipeline](#3-markov-chain-training-pipeline)
4. [Risk Scoring & Decision Logic](#4-risk-scoring--decision-logic)
5. [Out-of-Distribution (OOD) Detection](#5-out-of-distribution-ood-detection)
6. [Ensemble Model Strategy](#6-ensemble-model-strategy)
7. [Model Versioning & Deployment](#7-model-versioning--deployment)
8. [Data Flow Architecture](#8-data-flow-architecture)
9. [Cross-Entropy Calculation](#9-cross-entropy-calculation)
10. [Training Data Labeling Pipeline](#10-training-data-labeling-pipeline)

---

## 1. High-Level System Architecture

```mermaid
graph TB
    subgraph "Client Layer"
        A[HTTP Request<br/>POST /validate]
    end

    subgraph "Cloudflare Workers Edge"
        B[Hono Router<br/>CORS & Validation]
        C[Fingerprint Generator<br/>IP+JA4+ASN+BotScore]
        D[Email Validators<br/>Format & Entropy]
        E[Domain Validators<br/>TLD Risk & Disposable]
    end

    subgraph "Pattern Detection Layer"
        F1[Sequential<br/>Detector]
        F2[Dated<br/>Detector]
        F3[Plus-Addressing<br/>Detector]
        F4[TLD Risk<br/>Profiler]
        F5[Markov Chain<br/>PRIMARY DETECTOR]
        F6[OOD<br/>Detector]
    end

    subgraph "Risk Scoring Engine"
        G[Risk Aggregation<br/>Two-Dimensional Model]
        H[Decision Engine<br/>allow/warn/block]
    end

    subgraph "Storage & Analytics"
        I1[(KV Storage<br/>Markov Models)]
        I2[(D1 Database<br/>Analytics)]
        I3[Analytics Engine<br/>Metrics]
    end

    subgraph "Training Pipeline"
        J[Automated Training<br/>Pattern-Based Labels]
        K[Model Versioning<br/>Backup & Deploy]
    end

    subgraph "Response Layer"
        L[JSON Response<br/>risk/decision/signals]
        M[Structured Logging<br/>Pino.js]
    end

    A --> B
    B --> C
    B --> D
    B --> E

    D --> F1
    D --> F2
    D --> F3
    E --> F4
    D --> F5
    F5 --> F6

    F1 --> G
    F2 --> G
    F3 --> G
    F4 --> G
    F5 --> G
    F6 --> G

    G --> H
    H --> L
    H --> M
    H --> I3

    F5 -.loads models.-> I1
    M -.writes.-> I2
    I2 -.triggers.-> J
    J -.updates.-> K
    K -.deploys.-> I1

    L --> A

    style F5 fill:#4CAF50,stroke:#2E7D32,stroke-width:3px,color:#fff
    style F6 fill:#FF9800,stroke:#E65100,stroke-width:3px,color:#fff
    style G fill:#2196F3,stroke:#0D47A1,stroke-width:2px,color:#fff
```

---

## 2. Request Validation Flow

```mermaid
sequenceDiagram
    participant Client
    participant Worker as Cloudflare Worker
    participant KV as KV Storage
    participant Models as Markov Models
    participant Analytics as Analytics Engine
    participant D1 as D1 Database

    Client->>Worker: POST /validate<br/>{email: "user@example.com"}

    rect rgb(200, 230, 255)
        Note over Worker: Phase 1: Input Processing
        Worker->>Worker: Parse & validate JSON
        Worker->>Worker: Generate fingerprint<br/>(IP+JA4+ASN+BotScore)
        Worker->>Worker: Hash email (SHA-256)
    end

    rect rgb(255, 240, 200)
        Note over Worker: Phase 2: Format Validation
        Worker->>Worker: Check email format (RFC 5322)
        Worker->>Worker: Calculate entropy<br/>H(X) = -Σ p(x) log₂(p(x))
        Worker->>Worker: Validate domain<br/>(disposable check)
    end

    rect rgb(200, 255, 200)
        Note over Worker: Phase 3: Pattern Detection
        par Parallel Detection
            Worker->>Worker: Sequential pattern<br/>(user123, test001)
        and
            Worker->>Worker: Dated pattern<br/>(john.2025, oct2024)
        and
            Worker->>Worker: Plus-addressing<br/>(user+tag@gmail)
        and
            Worker->>Worker: TLD risk<br/>(.tk, .xyz profiling)
        end
    end

    rect rgb(255, 220, 255)
        Note over Worker,Models: Phase 4: Markov Chain Analysis
        Worker->>KV: Load models<br/>(cached globally)
        KV-->>Worker: MM_legit_2gram<br/>MM_fraud_2gram

        Worker->>Models: Calculate cross-entropy<br/>H(email, legit_model)
        Models-->>Worker: H_legit = 2.3 nats

        Worker->>Models: Calculate cross-entropy<br/>H(email, fraud_model)
        Models-->>Worker: H_fraud = 3.8 nats

        Worker->>Worker: Compare entropies<br/>diff = H_legit - H_fraud
        Worker->>Worker: Calculate confidence<br/>|diff| / H_legit
    end

    rect rgb(255, 200, 200)
        Note over Worker: Phase 5: OOD Detection
        Worker->>Worker: minEntropy = min(H_legit, H_fraud)

        alt minEntropy < 3.8 (Dead Zone)
            Worker->>Worker: abnormalityRisk = 0
        else minEntropy 3.8-5.5 (Warn Zone)
            Worker->>Worker: abnormalityRisk = 0.35 + linear
        else minEntropy > 5.5 (Block Zone)
            Worker->>Worker: abnormalityRisk = 0.65
        end
    end

    rect rgb(200, 220, 255)
        Note over Worker: Phase 6: Risk Scoring
        Worker->>Worker: classificationRisk = markov confidence
        Worker->>Worker: finalRisk = max(classification, abnormality)
        Worker->>Worker: finalRisk += domainRisk

        alt finalRisk > 0.6
            Worker->>Worker: decision = "block"
        else finalRisk > 0.3
            Worker->>Worker: decision = "warn"
        else
            Worker->>Worker: decision = "allow"
        end
    end

    rect rgb(220, 220, 220)
        Note over Worker,D1: Phase 7: Logging & Analytics
        par Parallel Writes (non-blocking)
            Worker->>Analytics: Write validation metric<br/>(async)
        and
            Worker->>D1: Write to validations table<br/>(async)
        end
    end

    Worker-->>Client: JSON Response<br/>{decision, riskScore, signals}

    Note over Worker,Client: Total latency: ~35ms
```

---

## 3. Markov Chain Training Pipeline

```mermaid
graph TB
    subgraph "Data Sources"
        A1[CSV Datasets<br/>111K legit + 105K fraud]
        A2[Analytics Engine<br/>Production Data]
        A3[Manual Labels<br/>Human-verified]
    end

    subgraph "Pattern-Based Labeling"
        B1[Load Raw Data]
        B2{Content-based<br/>or Pattern-based?}
        B3[Pattern Analysis<br/>- Keyboard walks<br/>- Sequential<br/>- Gibberish<br/>- Entropy]
        B4[Re-label Dataset<br/>Fix Mislabels]
        B5[Validate Labels<br/>Confidence Score]
    end

    subgraph "Data Preparation"
        C1[Load Existing Models<br/>from KV]
        C2[Separate by Label<br/>legit vs fraud]
        C3[Balance Dataset<br/>50/50 split]
        C4[Extract Local Parts<br/>Remove domains]
    end

    subgraph "Security Checks"
        D1{Minimum<br/>Samples?}
        D2{Anomaly<br/>Detection}
        D3[Check Distribution<br/>Benford's Law]
        D4[Check Volume Spikes]
        D5{Poisoning<br/>Detected?}
    end

    subgraph "Model Training"
        E1[Initialize n-gram Models<br/>orders: 2, 3]
        E2[Train Legitimate Model<br/>Learn char transitions]
        E3[Train Fraud Model<br/>Learn char transitions]
        E4[Calculate Statistics<br/>transition counts]
    end

    subgraph "Validation"
        F1[Load Test Set<br/>Hold-out 20%]
        F2[Run Cross-Validation]
        F3{Accuracy<br/>> 90%?}
        F4{Precision<br/>> 90%?}
        F5{Recall<br/>> 90%?}
        F6{False Positive<br/>< 5%?}
    end

    subgraph "Deployment"
        G1[Create Version ID<br/>timestamp-based]
        G2[Backup Current<br/>MM_*_backup]
        G3[Save Versioned<br/>MM_*_20251117_...]
        G4[Update Production<br/>MM_legit_2gram]
        G5[Update Metadata<br/>training stats]
        G6[Log Deployment<br/>Pino.js]
    end

    A1 --> B1
    A2 --> B1
    A3 --> B1

    B1 --> B2
    B2 -->|Content Labels| B3
    B2 -->|Pattern Labels| C1
    B3 --> B4
    B4 --> B5
    B5 --> C1

    C1 --> C2
    C2 --> C3
    C3 --> C4

    C4 --> D1
    D1 -->|>= 100 per class| D2
    D1 -->|< 100| ABORT[Abort: Insufficient Data]

    D2 --> D3
    D3 --> D4
    D4 --> D5
    D5 -->|No| E1
    D5 -->|Yes| ABORT2[Abort: Data Poisoning]

    E1 --> E2
    E2 --> E3
    E3 --> E4

    E4 --> F1
    F1 --> F2
    F2 --> F3
    F3 -->|Yes| F4
    F3 -->|No| REJECT[Reject: Low Accuracy]
    F4 -->|Yes| F5
    F4 -->|No| REJECT
    F5 -->|Yes| F6
    F5 -->|No| REJECT
    F6 -->|Yes| G1
    F6 -->|No| REJECT

    G1 --> G2
    G2 --> G3
    G3 --> G4
    G4 --> G5
    G5 --> G6

    style E2 fill:#4CAF50,stroke:#2E7D32,stroke-width:2px
    style E3 fill:#F44336,stroke:#C62828,stroke-width:2px
    style G4 fill:#2196F3,stroke:#0D47A1,stroke-width:2px
    style ABORT fill:#FF5722,stroke:#BF360C,stroke-width:2px
    style ABORT2 fill:#FF5722,stroke:#BF360C,stroke-width:2px
    style REJECT fill:#FFC107,stroke:#F57C00,stroke-width:2px
```

---

## 4. Risk Scoring & Decision Logic

```mermaid
graph TD
    START[Email Input] --> MARKOV[Markov Chain Analysis]

    subgraph "Markov Evaluation"
        MARKOV --> CROSS1[Calculate H_legit<br/>Cross-Entropy]
        MARKOV --> CROSS2[Calculate H_fraud<br/>Cross-Entropy]
        CROSS1 --> DIFF[diff = H_legit - H_fraud]
        CROSS2 --> DIFF
        DIFF --> CONF[confidence = |diff| / H_legit]
    end

    subgraph "Two-Dimensional Risk"
        CONF --> CLASS{diff > 0?}
        CLASS -->|Fraud fits better| CRISK1[classificationRisk = confidence]
        CLASS -->|Legit fits better| CRISK2[classificationRisk = 0]

        CROSS1 --> MIN[minEntropy = min]
        CROSS2 --> MIN

        MIN --> ZONE{Which OOD Zone?}
        ZONE -->|< 3.8 nats| ARISK1[abnormalityRisk = 0]
        ZONE -->|3.8-5.5 nats| ARISK2[abnormalityRisk = 0.35 + linear]
        ZONE -->|> 5.5 nats| ARISK3[abnormalityRisk = 0.65]
    end

    subgraph "Pattern Detection"
        START --> PAT1{Sequential?}
        PAT1 -->|Yes| PATRISK1[patternRisk = 0.8]
        PAT1 -->|No| PAT2{Dated?}
        PAT2 -->|Yes| PATRISK2[patternRisk = 0.7]
        PAT2 -->|No| PAT3{Plus-addressing?}
        PAT3 -->|Yes| PATRISK3[patternRisk = 0.6]
        PAT3 -->|No| PATRISK4[patternRisk = 0]
    end

    subgraph "Domain Analysis"
        START --> DOM1{Disposable?}
        DOM1 -->|Yes| DOMRISK1[domainRisk += 0.2]
        DOM1 -->|No| DOM2{High-risk TLD?}
        DOM2 -->|Yes .tk/.ml| DOMRISK2[domainRisk += 0.3]
        DOM2 -->|No| DOMRISK3[domainRisk = 0]
    end

    subgraph "Risk Aggregation"
        CRISK1 --> MAX[finalRisk = max]
        CRISK2 --> MAX
        ARISK1 --> MAX
        ARISK2 --> MAX
        ARISK3 --> MAX

        PATRISK1 --> MAXPAT[patternRisk = max]
        PATRISK2 --> MAXPAT
        PATRISK3 --> MAXPAT
        PATRISK4 --> MAXPAT

        MAX --> SUM[finalRisk = max + max]
        MAXPAT --> SUM

        DOMRISK1 --> ADDDOM[finalRisk += domainRisk]
        DOMRISK2 --> ADDDOM
        DOMRISK3 --> ADDDOM

        SUM --> ADDDOM
        ADDDOM --> CLAMP[Clamp to 0-1]
    end

    subgraph "Decision Logic"
        CLAMP --> DEC{Risk Level?}
        DEC -->|> 0.6| BLOCK[decision = 'block']
        DEC -->|0.3-0.6| WARN[decision = 'warn']
        DEC -->|< 0.3| ALLOW[decision = 'allow']
    end

    subgraph "Block Reason"
        BLOCK --> REASON{Primary Signal?}
        REASON -->|markovRisk > 0.6| BR1[markov_chain_fraud]
        REASON -->|abnormalityRisk > 0.4| BR2[high_abnormality]
        REASON -->|tldRisk > 0.5| BR3[high_risk_tld]
        REASON -->|domainRisk > 0.5| BR4[domain_reputation]
        REASON -->|dated pattern| BR5[dated_pattern]
        REASON -->|else| BR6[high_risk_multiple_signals]

        WARN --> WREASON{Primary Signal?}
        WREASON -->|abnormalityRisk > 0.2| WR1[suspicious_abnormal_pattern]
        WREASON -->|dated pattern| WR2[suspicious_dated_pattern]
        WREASON -->|else| WR3[medium_risk]
    end

    BR1 --> RESPONSE[Return JSON Response]
    BR2 --> RESPONSE
    BR3 --> RESPONSE
    BR4 --> RESPONSE
    BR5 --> RESPONSE
    BR6 --> RESPONSE
    WR1 --> RESPONSE
    WR2 --> RESPONSE
    WR3 --> RESPONSE
    ALLOW --> RESPONSE

    style CRISK1 fill:#F44336,stroke:#C62828
    style ARISK3 fill:#FF9800,stroke:#E65100
    style BLOCK fill:#F44336,stroke:#C62828,stroke-width:3px
    style WARN fill:#FFC107,stroke:#F57C00,stroke-width:3px
    style ALLOW fill:#4CAF50,stroke:#2E7D32,stroke-width:3px
```

---

## 5. Out-of-Distribution (OOD) Detection

```mermaid
flowchart TD
    START[Markov Chain Results<br/>H_legit, H_fraud] --> MIN[Calculate minEntropy<br/>min = Math.min]

    MIN --> CHECK{minEntropy vs<br/>Thresholds?}

    subgraph "Dead Zone - Familiar Patterns"
        CHECK -->|< 3.8 nats| DEAD[Zone: DEAD<br/>abnormalityRisk = 0<br/>oodDetected = false]
        DEAD --> EX1[Example: person1@gmail.com<br/>H_legit=2.1, H_fraud=3.8<br/>min=2.1]
    end

    subgraph "Warn Zone - Unusual Patterns"
        CHECK -->|3.8 to 5.5 nats| WARN_ZONE[Zone: WARN<br/>Calculate Progress]
        WARN_ZONE --> PROGRESS[progress = minEntropy - 3.8 / 1.7]
        PROGRESS --> WARN_CALC[abnormalityRisk =<br/>0.35 + progress × 0.30]
        WARN_CALC --> WARN_FLAG[oodDetected = true<br/>oodZone = 'warn']
        WARN_FLAG --> EX2[Example: inearkstioarsitm@gmail<br/>H_legit=4.45, H_fraud=4.68<br/>min=4.45 → risk=0.46]
    end

    subgraph "Block Zone - Gibberish"
        CHECK -->|> 5.5 nats| BLOCK_ZONE[Zone: BLOCK<br/>abnormalityRisk = 0.65]
        BLOCK_ZONE --> BLOCK_FLAG[oodDetected = true<br/>oodZone = 'block']
        BLOCK_FLAG --> EX3[Example: xkjgh2k9qw@gmail.com<br/>H_legit=6.23, H_fraud=6.01<br/>min=6.01 → risk=0.65]
    end

    subgraph "Two-Dimensional Model"
        DEAD --> TWODIM[Combine with Classification]
        WARN_FLAG --> TWODIM
        BLOCK_FLAG --> TWODIM

        TWODIM --> CLASS[classificationRisk from Markov]
        CLASS --> FINAL[finalRisk = max<br/>classificationRisk<br/>abnormalityRisk]
    end

    subgraph "Risk Interpretation"
        FINAL --> RISK_LEVEL{Combined Risk?}
        RISK_LEVEL -->|< 0.35| R1[ALLOW<br/>Low risk, familiar]
        RISK_LEVEL -->|0.35-0.65| R2[WARN<br/>Unusual pattern]
        RISK_LEVEL -->|> 0.65| R3[BLOCK<br/>Gibberish/Extreme]
    end

    subgraph "Database Tracking"
        R1 --> DB[Write to D1]
        R2 --> DB
        R3 --> DB

        DB --> FIELDS[Store Fields:<br/>- min_entropy<br/>- abnormality_score<br/>- abnormality_risk<br/>- ood_detected<br/>- ood_zone]
    end

    FIELDS --> END[Return Decision]

    style DEAD fill:#4CAF50,stroke:#2E7D32,stroke-width:2px
    style WARN_ZONE fill:#FFC107,stroke:#F57C00,stroke-width:2px
    style BLOCK_ZONE fill:#F44336,stroke:#C62828,stroke-width:2px
    style FINAL fill:#2196F3,stroke:#0D47A1,stroke-width:3px

    classDef deadClass fill:#C8E6C9,stroke:#388E3C
    classDef warnClass fill:#FFF9C4,stroke:#F57C00
    classDef blockClass fill:#FFCDD2,stroke:#C62828

    class EX1 deadClass
    class EX2 warnClass
    class EX3 blockClass
```

---

## 6. Ensemble Model Strategy

```mermaid
graph TD
    START[Email Local Part] --> SPLIT[Process with Both Models]

    subgraph "2-gram Model"
        SPLIT --> MODEL2[2-gram Markov Chain]
        MODEL2 --> H2L[H_legit_2gram]
        MODEL2 --> H2F[H_fraud_2gram]
        H2L --> CONF2[Calculate confidence_2<br/>diff / max]
        H2F --> CONF2
        CONF2 --> PRED2{Prediction_2}
        PRED2 -->|H_fraud < H_legit| PRED2F[fraud]
        PRED2 -->|H_legit < H_fraud| PRED2L[legit]
    end

    subgraph "3-gram Model"
        SPLIT --> MODEL3[3-gram Markov Chain]
        MODEL3 --> H3L[H_legit_3gram]
        MODEL3 --> H3F[H_fraud_3gram]
        H3L --> CONF3[Calculate confidence_3<br/>diff / max]
        H3F --> CONF3
        CONF3 --> PRED3{Prediction_3}
        PRED3 -->|H_fraud < H_legit| PRED3F[fraud]
        PRED3 -->|H_legit < H_fraud| PRED3L[legit]
    end

    subgraph "Ensemble Decision Logic"
        PRED2F --> AGREE{Models Agree?}
        PRED2L --> AGREE
        PRED3F --> AGREE
        PRED3L --> AGREE

        AGREE -->|Yes + both conf > 0.3| RULE1[✅ Use consensus<br/>Take max confidence<br/>Reason: both_agree_high_confidence]

        AGREE -->|No| CHECK3[Check 3-gram confidence]
        CHECK3 --> RULE2{3-gram conf > 0.5<br/>AND > 1.5× conf_2?}
        RULE2 -->|Yes| OVERRIDE[✅ Trust 3-gram<br/>Use prediction_3<br/>Reason: 3gram_high_confidence_override]

        RULE2 -->|No| CHECK_GIBBERISH{2-gram predicts fraud<br/>AND H_fraud > 6.0?}
        CHECK_GIBBERISH -->|Yes| GIBBERISH[✅ Gibberish detected<br/>Use 2-gram fraud<br/>Reason: 2gram_gibberish_detection]

        CHECK_GIBBERISH -->|No| DISAGREE{Models disagree?}
        DISAGREE -->|Yes| DEFAULT[✅ Default to 2-gram<br/>More robust<br/>Reason: disagree_default_to_2gram]

        DISAGREE -->|No| HIGHER{Which higher<br/>confidence?}
        HIGHER -->|conf_2 >= conf_3| USE2[✅ Use 2-gram<br/>Reason: 2gram_higher_confidence]
        HIGHER -->|conf_3 > conf_2| USE3[✅ Use 3-gram<br/>Reason: 3gram_higher_confidence]
    end

    subgraph "Strengths Analysis"
        MODEL2 --> S2[2-gram Strengths:<br/>+ Robust gibberish<br/>+ Low false positives<br/>+ Works with 44K samples<br/>- Limited context]

        MODEL3 --> S3[3-gram Strengths:<br/>+ Better context 2 chars<br/>+ High confidence when trained<br/>- Needs 200K-1M samples<br/>- Prone to overfitting]
    end

    RULE1 --> FINAL[Final Ensemble Decision]
    OVERRIDE --> FINAL
    GIBBERISH --> FINAL
    DEFAULT --> FINAL
    USE2 --> FINAL
    USE3 --> FINAL

    FINAL --> METRICS[Track Metrics:<br/>- Disagreement rate<br/>- Override frequency<br/>- Per-reasoning accuracy]

    METRICS --> OUTPUT[Return:<br/>- prediction<br/>- confidence<br/>- reasoning<br/>- both entropies]

    style RULE1 fill:#4CAF50,stroke:#2E7D32,stroke-width:2px
    style OVERRIDE fill:#2196F3,stroke:#0D47A1,stroke-width:2px
    style GIBBERISH fill:#FF9800,stroke:#E65100,stroke-width:2px
    style DEFAULT fill:#9E9E9E,stroke:#424242,stroke-width:2px
    style MODEL2 fill:#E3F2FD,stroke:#1976D2
    style MODEL3 fill:#F3E5F5,stroke:#7B1FA2
```

---

## 7. Model Versioning & Deployment

```mermaid
stateDiagram-v2
    [*] --> Training: Start Training Pipeline

    state Training {
        [*] --> LoadExisting: Load Current Production
        LoadExisting --> Incremental: Existing Models Found
        LoadExisting --> FromScratch: No Models Found

        Incremental --> TrainNew: Add New Samples
        FromScratch --> TrainNew: Train Full Dataset

        TrainNew --> Validate: Training Complete
        Validate --> MetricsCheck: Run Validation

        MetricsCheck --> PassedValidation: Acc>90%, Prec>90%, Recall>90%
        MetricsCheck --> FailedValidation: Metrics Below Threshold

        FailedValidation --> [*]: Abort Deployment
    }

    PassedValidation --> Versioning: Create Version

    state Versioning {
        [*] --> GenerateID: timestamp + hash
        GenerateID --> BackupCurrent: Save Production as Backup
        BackupCurrent --> SaveVersioned: Create Versioned Copy

        state SaveVersioned {
            [*] --> LegitModel: MM_legit_2gram_20251117_153045
            [*] --> FraudModel: MM_fraud_2gram_20251117_153045
            [*] --> Metadata: Version metadata + stats
        }
    }

    SaveVersioned --> Deployment: Deploy to Production

    state Deployment {
        [*] --> UpdateProduction: Atomic KV Write

        state UpdateProduction {
            [*] --> UpdateLegit: MM_legit_2gram
            [*] --> UpdateFraud: MM_fraud_2gram
            [*] --> UpdatePointer: production_model_version
        }

        UpdateProduction --> GlobalCacheClear: Workers Reload
    }

    GlobalCacheClear --> Monitoring: Track Performance

    state Monitoring {
        [*] --> LiveMetrics: Real-time Accuracy
        LiveMetrics --> FalsePositiveCheck: Monitor FP Rate
        FalsePositiveCheck --> PerformanceOK: < 5% FP Rate
        FalsePositiveCheck --> PerformanceIssue: > 5% FP Rate

        PerformanceIssue --> Rollback: Restore Backup
        PerformanceOK --> Continue: Keep Monitoring
    }

    state Rollback {
        [*] --> RestoreBackup: MM_*_backup → MM_*
        RestoreBackup --> NotifyAdmin: Alert via Logs
    }

    Continue --> [*]: Deployment Success
    Rollback --> [*]: Rollback Complete

    note right of Training
        Training can be triggered:
        - Manually via CLI
        - API endpoint (with caution)
        - Previously: Cron (disabled)
    end note

    note right of Versioning
        Version Format:
        MM_{legit|fraud}_{order}gram_{YYYYMMDD}_{HHMMSS}

        Example:
        MM_legit_2gram_20251117_153045
    end note

    note right of Deployment
        Atomic deployment:
        1. Write all models
        2. Update pointer
        3. Workers reload on next request

        No downtime!
    end note
```

---

## 8. Data Flow Architecture

```mermaid
graph LR
    subgraph "Production Traffic"
        A[User Signups] -->|POST /validate| B[Cloudflare Worker]
    end

    subgraph "Validation Layer"
        B --> C[Fraud Detection]
        C --> D[Markov Analysis]
        D --> E{Decision}
    end

    subgraph "Real-time Storage"
        E -->|allow/warn/block| F[(Analytics Engine<br/>Time-series Data)]
        E --> G[(D1 Database<br/>Validations Table)]
        C --> H[Structured Logs<br/>Pino.js]
    end

    subgraph "Training Data Pipeline - CLI Approach"
        I[CSV Datasets<br/>111K+ samples] -->|Pattern Re-label| J[train:relabel]
        J --> K[Pattern-Based Labels<br/>legit vs fraud]
        K -->|train:markov| L[Training Pipeline]
    end

    subgraph "Training Data Pipeline - Online Approach DISABLED"
        F -.->|Query last 7 days| M[Fetch Training Data]
        M -.-> N[Heuristic Labeling<br/>risk_score >= 0.7]
        N -.-> O[Security Checks<br/>Anomaly Detection]
        O -.-> L
    end

    subgraph "Model Training"
        L --> P[Load Existing Models<br/>Incremental Training]
        P --> Q[Train N-gram Models<br/>2-gram + 3-gram]
        Q --> R[Validation<br/>Accuracy/Precision/Recall]
    end

    subgraph "Model Storage"
        R -->|Pass| S[(KV Storage<br/>MARKOV_MODEL)]
        S --> T[Versioned Models<br/>MM_*_20251117_...]
        S --> U[Production Models<br/>MM_legit_2gram]
        S --> V[Backup Models<br/>MM_*_backup]
    end

    subgraph "Model Deployment"
        U -.->|Load at startup| D
        D -.->|Cached globally| W[In-Memory Cache<br/>Worker Instance]
    end

    subgraph "Analytics & Monitoring"
        G --> X[Dashboard Queries<br/>Pattern Analysis]
        H --> Y[CloudFlare Logs<br/>Search & Debug]
        F --> Z[SQL Queries<br/>Metrics & Stats]
    end

    subgraph "Model Updates"
        X -.->|Identify Issues| AA[Admin Review]
        AA -.->|Manual Training| I
        AA -.->|API Training| M
    end

    style F fill:#FFE082,stroke:#F57C00
    style G fill:#81C784,stroke:#388E3C
    style S fill:#64B5F6,stroke:#1976D2
    style D fill:#BA68C8,stroke:#7B1FA2,stroke-width:3px
    style L fill:#4CAF50,stroke:#2E7D32,stroke-width:2px

    linkStyle 10 stroke:#F44336,stroke-width:2px,stroke-dasharray: 5 5
    linkStyle 11 stroke:#F44336,stroke-width:2px,stroke-dasharray: 5 5
    linkStyle 12 stroke:#F44336,stroke-width:2px,stroke-dasharray: 5 5
```

---

## 9. Cross-Entropy Calculation

```mermaid
flowchart TD
    START[Input: Email Local Part<br/>Example: user123] --> CONTEXT[Initialize Context<br/>order = 2 for bigrams]

    CONTEXT --> PAD[Pad with Start Tokens<br/>^^user123]

    PAD --> LOOP[Iterate Through Characters]

    subgraph "For Each Character Position"
        LOOP --> CHAR[Current char: 'u'<br/>Context: '^^']

        CHAR --> LOOKUP[Lookup in Transition Matrix<br/>transitionCounts['^^']['u']]

        LOOKUP --> FOUND{Transition<br/>Exists?}

        FOUND -->|Yes| CALC_PROB[Calculate Probability<br/>P = count / total_from_context]
        FOUND -->|No| SMOOTH[Apply Smoothing<br/>P = epsilon / vocab_size]

        CALC_PROB --> LOG[Calculate Log<br/>log₂ P]
        SMOOTH --> LOG

        LOG --> ACC[Accumulate<br/>sum += -log₂ P]

        ACC --> UPDATE[Update Context<br/>'^u' for next char]

        UPDATE --> NEXT{More<br/>characters?}
        NEXT -->|Yes| CHAR
    end

    NEXT -->|No| AVG[Calculate Average<br/>H = sum / length]

    subgraph "Detailed Example: user123"
        EX1[Position 0: Context='^^', Char='u'<br/>P^^→u = 0.15 → -log₂0.15 = 2.74]
        EX2[Position 1: Context='^u', Char='s'<br/>P^u→s = 0.08 → -log₂0.08 = 3.64]
        EX3[Position 2: Context='us', Char='e'<br/>Pus→e = 0.22 → -log₂0.22 = 2.18]
        EX4[Position 3: Context='se', Char='r'<br/>Pse→r = 0.18 → -log₂0.18 = 2.47]
        EX5[Positions 4-7: Continue...<br/>Sum all -log₂ P values]
        EX6[Final: H = sum / 7<br/>Cross-Entropy in nats]
    end

    AVG --> INTERPRET{Interpretation}

    subgraph "Cross-Entropy Ranges"
        INTERPRET -->|< 0.2 nats| GOOD[Excellent Fit<br/>Model predicts well]
        INTERPRET -->|0.2-1.0 nats| OKAY[Good Fit<br/>Expected for training data]
        INTERPRET -->|1.0-3.0 nats| POOR[Poor Fit<br/>Unfamiliar pattern]
        INTERPRET -->|> 3.0 nats| OOD[Out-of-Distribution<br/>Model very confused]
    end

    subgraph "Model Comparison"
        AVG --> LEGIT[H_legit = 2.3<br/>Legitimate Model]
        AVG --> FRAUD[H_fraud = 3.8<br/>Fraud Model]

        LEGIT --> DIFF[diff = H_legit - H_fraud<br/>= 2.3 - 3.8 = -1.5]
        FRAUD --> DIFF

        DIFF --> DECISION{Sign of diff?}
        DECISION -->|Negative| PRED_LEGIT[Predicted: Legitimate<br/>Lower entropy = better fit]
        DECISION -->|Positive| PRED_FRAUD[Predicted: Fraudulent<br/>Fraud model fits better]

        PRED_LEGIT --> CONFIDENCE[Confidence = |diff| / max<br/>= 1.5 / 3.8 = 0.39]
        PRED_FRAUD --> CONFIDENCE
    end

    CONFIDENCE --> RETURN[Return Results:<br/>- H_legit<br/>- H_fraud<br/>- prediction<br/>- confidence]

    style GOOD fill:#4CAF50,stroke:#2E7D32
    style OKAY fill:#8BC34A,stroke:#558B2F
    style POOR fill:#FFC107,stroke:#F57C00
    style OOD fill:#F44336,stroke:#C62828
    style PRED_LEGIT fill:#81C784,stroke:#388E3C
    style PRED_FRAUD fill:#E57373,stroke:#C62828

    classDef exampleClass fill:#E3F2FD,stroke:#1976D2
    class EX1,EX2,EX3,EX4,EX5,EX6 exampleClass
```

---

## 10. Training Data Labeling Pipeline

```mermaid
graph TB
    START[Raw Dataset<br/>91,966 emails] --> CHECK{Label<br/>Source?}

    subgraph "Problem: Content-Based Labels"
        CHECK -->|Message Content| CONTENT[Spam/Phishing Labels<br/>Based on Email BODY]
        CONTENT --> ISSUE1[Issue: person1.person2@domain.com<br/>Labeled FRAUD because message was spam]
        ISSUE1 --> ISSUE2[Problem: Pattern is LEGITIMATE<br/>but labeled as FRAUD]
        ISSUE2 --> MISMATCH[Result: 47% Mislabeled<br/>36,225 legit names as fraud]
    end

    subgraph "Solution: Pattern-Based Re-labeling"
        CHECK -->|CLI Re-label| RELABEL[train:relabel Command]
        MISMATCH --> RELABEL

        RELABEL --> ANALYZE[Pattern Analysis Engine]

        ANALYZE --> PAT1[Check: Keyboard Walks<br/>qwerty, asdfgh, zxcvbn]
        ANALYZE --> PAT2[Check: Sequential<br/>user123, test001]
        ANALYZE --> PAT3[Check: Gibberish<br/>xkjgh2k9qw]
        ANALYZE --> PAT4[Check: Entropy<br/>Randomness score]
        ANALYZE --> PAT5[Check: N-gram Naturalness<br/>Common bigrams/trigrams]
        ANALYZE --> PAT6[Check: Name Patterns<br/>person1.person2, first_last]
    end

    subgraph "Multi-Factor Decision"
        PAT1 --> SCORE[Calculate Pattern Score<br/>0-100 scale]
        PAT2 --> SCORE
        PAT3 --> SCORE
        PAT4 --> SCORE
        PAT5 --> SCORE
        PAT6 --> SCORE

        SCORE --> THRESHOLD{Pattern<br/>Classification}

        THRESHOLD -->|Score > 70| FRAUD_LABEL[Label: FRAUD<br/>confidence: high]
        THRESHOLD -->|Score 30-70| AMBIG_LABEL[Label: AMBIGUOUS<br/>confidence: medium]
        THRESHOLD -->|Score < 30| LEGIT_LABEL[Label: LEGITIMATE<br/>confidence: high]
    end

    subgraph "Validation & Output"
        FRAUD_LABEL --> COMPARE{Original<br/>Label?}
        AMBIG_LABEL --> COMPARE
        LEGIT_LABEL --> COMPARE

        COMPARE -->|Changed| CHANGED[Mark as CHANGED<br/>Track reason]
        COMPARE -->|Same| UNCHANGED[Mark as UNCHANGED<br/>Confidence boost]

        CHANGED --> OUTPUT[Output CSV:<br/>- email<br/>- new_label<br/>- original_label<br/>- reason<br/>- confidence<br/>- changed_flag]
        UNCHANGED --> OUTPUT
    end

    subgraph "Results Analysis"
        OUTPUT --> STATS[Statistics:<br/>- 50.2K legit 49.8%<br/>- 41.8K fraud 45%<br/>- 7.2K ambiguous 7%]

        STATS --> BALANCE[Balanced Dataset<br/>50/50 legit/fraud]

        BALANCE --> EXAMPLES[Examples:<br/>✅ person1.person2 → LEGIT<br/>✅ first_last → LEGIT<br/>⚠️ xkjgh2k9qw → FRAUD<br/>⚠️ qwertyuiop → FRAUD<br/>❓ very_short → AMBIGUOUS]
    end

    EXAMPLES --> TRAIN[Ready for Training<br/>train:markov]

    subgraph "Training with Clean Labels"
        TRAIN --> SEPARATE[Separate by Label<br/>legit vs fraud]
        SEPARATE --> EXCLUDE[Exclude AMBIGUOUS<br/>Keep high-confidence only]
        EXCLUDE --> MARKOV[Train Markov Models<br/>2-gram + 3-gram]
        MARKOV --> RESULT[Result: Accurate Models<br/>Learn TRUE patterns<br/>not message content]
    end

    style ISSUE1 fill:#FFCDD2,stroke:#C62828
    style ISSUE2 fill:#FFCDD2,stroke:#C62828
    style MISMATCH fill:#F44336,stroke:#B71C1C,stroke-width:3px
    style RELABEL fill:#2196F3,stroke:#0D47A1,stroke-width:3px
    style BALANCE fill:#4CAF50,stroke:#2E7D32,stroke-width:2px
    style RESULT fill:#4CAF50,stroke:#2E7D32,stroke-width:3px

    style FRAUD_LABEL fill:#FFAB91,stroke:#D84315
    style LEGIT_LABEL fill:#A5D6A7,stroke:#388E3C
    style AMBIG_LABEL fill:#FFF59D,stroke:#F57C00
```

---

## Summary

This comprehensive documentation provides visual representations of:

1. **System Architecture** - How all components interact
2. **Request Flow** - Step-by-step validation process with timing
3. **Training Pipeline** - From data collection to model deployment
4. **Risk Scoring** - Two-dimensional risk model with OOD detection
5. **OOD Detection** - Three-zone threshold system
6. **Ensemble Strategy** - How 2-gram and 3-gram models collaborate
7. **Model Versioning** - Safe deployment with rollback capability
8. **Data Flow** - Production traffic to model updates
9. **Cross-Entropy** - Mathematical foundation with examples
10. **Data Labeling** - Pattern-based vs content-based labeling

## Quick Reference

### Key Metrics
- **Latency**: ~35ms average, <50ms p95
- **Accuracy**: 83% (2-gram), 98% with ensemble
- **Training Data**: 111K legit + 105K fraud
- **Detection Rate**: 95-98%
- **False Positives**: <1% with Markov-only approach

### Critical Thresholds
- **OOD Dead Zone**: < 3.8 nats (no risk)
- **OOD Warn Zone**: 3.8-5.5 nats (progressive risk)
- **OOD Block Zone**: > 5.5 nats (maximum risk 0.65)
- **Block Decision**: risk > 0.6
- **Warn Decision**: risk 0.3-0.6
- **Allow Decision**: risk < 0.3

### Model Locations
- **Production**: `MM_legit_2gram`, `MM_fraud_2gram`
- **Backup**: `MM_legit_2gram_backup`, `MM_fraud_2gram_backup`
- **Versioned**: `MM_legit_2gram_20251117_153045`
- **Storage**: KV Namespace `MARKOV_MODEL`

---

**For implementation details, see:**
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [DETECTORS.md](./DETECTORS.md)
- [TRAINING.md](./TRAINING.md)
- [OOD_DETECTION.md](./OOD_DETECTION.md)
- [SCORING.md](./SCORING.md)
