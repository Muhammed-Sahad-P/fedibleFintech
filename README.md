# Fedible — Fintech Backend & Financial Engineering Engine

A production-grade, highly reliable fintech backend engine built for the **Fedible 24-Hour Technical Assessment**.

Engineered with **PostgreSQL ACID transaction boundaries**, **inbox-pattern webhook idempotency**, **Redis L2 response caching & rate limiting**, **FEFF multi-tenant document isolation**, and **AI-driven financial health analysis with strict data minimisation**.

---

## System Architecture

```mermaid
graph TD
    subgraph Client_Tier["Client & External Ingress"]
        ClientApp["Client Application (Web / Mobile / Third-Party)"]
    end

    subgraph Edge_Security["Edge & Security Layer"]
        Gateway["API Gateway / ALB<br/>• TLS 1.3 Termination<br/>• Correlation ID (X-Correlation-ID)<br/>• Security Headers (Helmet)"]
    end

    subgraph Application_Tier["Fedible Backend Services (Node.js 20 / TypeScript)"]
        AuthService["Auth & Identity Service<br/>• JWT Bearer Authentication<br/>• Role-Based Access Control (USER, ADMIN)<br/>• bcrypt Password Hashing"]
        FeditscoreService["Feditscore Engine<br/>• Weighted Category Scoring<br/>• Risk Tier Classifier<br/>• Cache-Aside & Invalidation"]
        PaymentService["Payment Orchestrator<br/>• State Machine (PENDING → SUCCESS / FAILED)<br/>• HMAC Webhook Verification<br/>• Inbox Pattern Deduplication<br/>• Background Crash Reconciler"]
        FEFFService["FEFF Document Vault<br/>• Magic-Byte MIME Validation<br/>• SHA-256 Integrity Hashing<br/>• Multi-Tenant Isolation (404 on breach)"]
        AIAssistantService["AI Financial Advisor<br/>• Data Minimisation (Numbers only)<br/>• Zero Identifier Transmission<br/>• Heuristic Fallback Engine"]
    end

    subgraph Storage_Tier["Storage & Caching Tier"]
        PostgreSQL[("PostgreSQL 16 (Primary DB)<br/>• ACID Ledger & Row Locks (SELECT FOR UPDATE)<br/>• Minor Currency Units (BIGINT amount_minor)<br/>• UNIQUE(event_id), UNIQUE(gateway_tx_id)<br/>• Append-Only Audit Logs")]
        RedisCache[("Redis 7.2 Cache & Rate Limiting<br/>• Score Caching (TTL 1hr)<br/>• Fixed-Window Rate Limiting<br/>• Sub-2ms Read Latency")]
        StorageVault[("Document Vault (S3 / Local Encrypted)<br/>• Isolated UUID File Paths<br/>• Magic-Byte Whitelisting")]
    end

    subgraph External_Services["External Providers"]
        PaymentGateway["Payment Gateway (Mock / Razorpay / Stripe)<br/>• Cryptographic Webhook Delivery<br/>• Settlement Reconciliation API"]
        LLMProvider["Google Gemini / LLM Provider<br/>• Stateless Prompt Evaluation"]
    end

    %% Ingress Connections
    ClientApp -->|HTTPS / REST| Gateway
    Gateway --> AuthService
    Gateway --> FeditscoreService
    Gateway --> PaymentService
    Gateway --> FEFFService
    Gateway --> AIAssistantService

    %% Storage Connections
    AuthService --> PostgreSQL
    FeditscoreService --> PostgreSQL
    FeditscoreService <-->|Cache HIT / MISS / Invalidate| RedisCache
    PaymentService -->|SELECT FOR UPDATE / Inbox Pattern| PostgreSQL
    FEFFService --> PostgreSQL
    FEFFService --> StorageVault
    AIAssistantService --> LLMProvider

    %% Gateway Ingress
    PaymentGateway -->|Signed Webhook (HMAC-SHA256)| PaymentService
    PaymentService -.->|Periodic Query (Reconciler Backup)| PaymentGateway
```

---

## Quickstart & Execution Guide

You can run the entire system via **Docker** (recommended) or in **Hybrid / Native Node Mode**.

### Option A: 1-Command Full Docker Setup (Recommended)
Spins up PostgreSQL 16, Redis 7.2, and the Fedible Backend API in isolated containers:

```bash
# 1. Clone the repository
git clone https://github.com/Muhammed-Sahad-P/fedibleFintech.git
cd fedibleFintech

# 2. Build and start all services
docker compose up --build -d

# 3. View live server logs
docker compose logs -f api
```
- API will be live at: `http://localhost:4000`
- Health probe: `http://localhost:4000/health`

---

### Option B: Local Native Node Setup (Fast Dev)

```bash
# 1. Start Postgres & Redis dependencies
docker compose up -d postgres redis

# 2. Install dependencies
npm install

# 3. Run database migrations & seed canonical questions
npm run migrate
npm run seed

# 4. Start TypeScript development server (with hot reloading)
npm run dev
```

---

## Running the Automated Test Suite

```bash
# Run all unit, integration, and concurrency tests
npm test
```

The test suite validates:
1. **Auth & RBAC**: Registration, login, password hashing, JWT expiration.
2. **Feditscore & Redis Caching**: Assessment evaluation, `X-Cache: HIT/MISS`, automatic invalidation on answer update.
3. **Payment Concurrency & Idempotency**: **5 concurrent duplicate webhooks result in exactly 1 transaction** processed, with 4 idempotently acknowledged.
4. **FEFF Document Vault & IDOR Isolation**: Magic-byte inspection, SHA-256 verification, and returning **`404 Not Found`** when User B accesses User A's document (+ audit logging).
5. **Crash Recovery & Reconciliation**: Simulating database crash post-gateway settlement and triggering the admin reconciliation safety net to auto-heal orphaned charges.
6. **AI Assistant**: Financial diagnostics, data minimisation, and fallback engine.

---

## Comprehensive API Reference

### 1. Authentication & Identity
| Method | Endpoint | Description | Auth |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/register` | Register new user (`email`, `password`, `fullName`, `role`) | Public |
| `POST` | `/api/v1/auth/login` | Login and receive Bearer JWT | Public |
| `GET` | `/api/v1/auth/me` | Fetch authenticated user profile | Bearer JWT |

### 2. Feditscore Scoring Engine (Tasks 2 & 7)
| Method | Endpoint | Description | Auth |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/assessment` | Start new assessment session & receive active questions | Bearer JWT |
| `POST` | `/api/v1/assessment/:id/answers` | Submit answers, calculate score (300–900), invalidate Redis cache | Bearer JWT |
| `GET` | `/api/v1/assessment/:id/result` | Retrieve score & category breakdown (cached in Redis with `X-Cache`) | Bearer JWT |

### 3. Payment Processing & Idempotent Webhooks (Tasks 4, 5 & 8)
| Method | Endpoint | Description | Auth |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/payments/create` | Create payment order (`amountMinor`, `currency`, `paymentMethod`, `idempotencyKey`) | Bearer JWT |
| `POST` | `/api/v1/payments/mock-gateway/process` | Simulate gateway checkout & trigger signed webhook | Public / Test |
| `POST` | `/api/v1/webhooks/payment` | HMAC-SHA256 verified webhook ingress with Inbox deduplication | Public (Signed) |
| `GET` | `/api/v1/payments/:referenceId` | Fetch verified payment status | Bearer JWT |
| `POST` | `/api/v1/payments/simulate-crash` | Simulate DB crash scenario (charge settled at gateway, PENDING in DB) | Bearer JWT |
| `POST` | `/api/v1/payments/reconcile` | Trigger background reconciliation worker for orphaned charges | `ADMIN` Role |

### 4. Secure FEFF Document Vault (Task 6)
| Method | Endpoint | Description | Auth |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/documents/upload` | Upload PDF/PNG/JPG (magic-byte check + SHA-256 hash) | Bearer JWT |
| `GET` | `/api/v1/documents` | List authenticated user's documents | Bearer JWT |
| `GET` | `/api/v1/documents/:id` | Get document metadata (Returns `404` for unauthorized users) | Bearer JWT |
| `GET` | `/api/v1/documents/:id/download` | Download/stream document file | Bearer JWT |
| `DELETE` | `/api/v1/documents/:id` | Delete document & log security audit trail | Bearer JWT |

### 5. AI Financial Assistant (Task 9)
| Method | Endpoint | Description | Auth |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/financial-assistant` | Submit numeric financials (`income`, `expenses`, `savings`, `debt`, `goals`) | Bearer JWT |

### 6. Production Debugging Challenge (Task 10)
| Method | Endpoint | Description | Auth |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/debug/slow-assessment-report` | Buggy endpoint demonstrating N+1 query loop and unindexed scan | Bearer JWT |
| `GET` | `/api/v1/debug/optimized-assessment-report` | Optimized endpoint using single `json_agg` query & composite index | Bearer JWT |

---

## AWS / Production Architecture (5 Marks)

```
                       +-----------------------------------+
                       |        AWS Route 53 / CloudFront  |
                       +-----------------+-----------------+
                                         | HTTPS (TLS 1.3)
                                         v
                       +-----------------------------------+
                       |    Application Load Balancer      |
                       +-----------------+-----------------+
                                         |
                       +-----------------+-----------------+
                       |   AWS ECS (Fargate) / App Nodes   |
                       |   - Stateless Docker Containers   |
                       |   - Node.js 20 Express APIs       |
                       +---+-------------+-------------+---+
                           |             |             |
            +--------------+             |             +--------------+
            |                            |                            |
            v                            v                            v
+-----------------------+    +-----------------------+    +-----------------------+
|  AWS RDS (PostgreSQL) |    | AWS ElastiCache(Redis)|    |     AWS S3 Bucket     |
| - Multi-AZ Deployment |    | - Score Caching (TTL) |    | - FEFF Documents      |
| - Automated Backups   |    | - Rate Limiting       |    | - SSE-S3 / KMS Encrypt|
| - Parameterized DML   |    | - Read Replicas       |    | - Private Bucket      |
+-----------------------+    +-----------------------+    +-----------------------+
```

| Component | AWS Primitive | Production Configuration & Security |
| :--- | :--- | :--- |
| **Relational Database** | AWS RDS (PostgreSQL 16) | Multi-AZ standby replica, automated snapshots, encrypted storage (AWS KMS), private VPC subnets. |
| **In-Memory Cache** | AWS ElastiCache (Redis OSS) | Multi-node cluster with in-transit & at-rest encryption, automated failover. |
| **Document Storage** | AWS S3 | Private bucket, Server-Side Encryption (SSE-S3 / KMS), non-public bucket policies. |
| **Async Webhooks** | AWS SQS | Dead-Letter Queue (DLQ) for failed webhook ingestion retries. |
| **Secrets & Keys** | AWS Secrets Manager | Automatic rotation for DB credentials, JWT secrets, and webhook signing keys. |
| **Observability** | Amazon CloudWatch | Structured JSON logs, error alarm triggers, and metric dashboards. |

---

## Decisions & Trade-offs

1. **PostgreSQL as the Single Source of Truth for Concurrency**:
   - *Decision*: We rely on PostgreSQL `UNIQUE` constraints (`event_id`, `gateway_tx_id`), `INSERT ... ON CONFLICT DO NOTHING`, and `SELECT ... FOR UPDATE` row-level pessimistic locks rather than external distributed locks.
   - *Trade-off*: Slightly higher write contention on identical resource updates under extreme throughput, but eliminates split-brain / lock-release failure modes across distributed Redis nodes.
2. **Minor Currency Units (`BIGINT amount_minor`)**:
   - *Decision*: Monetary values are stored as integers (paise/cents) rather than floating point numbers.
   - *Trade-off*: Requires conversion when displaying currency to humans, but completely eliminates IEEE-754 precision rounding bugs.
3. **Anti-Enumeration `404 Not Found` for Unauthorized Documents**:
   - *Decision*: If User B attempts to access User A's document, the API returns `404 Not Found` rather than `403 Forbidden`.
   - *Trade-off*: Does not explicitly distinguish between non-existent documents and unauthorized access to clients, but prevents attackers from enumerating valid document IDs across tenants.
4. **Data Minimisation over Free-Text LLM Prompts**:
   - *Decision*: The AI Assistant endpoint accepts strictly numeric financial parameters and enum goals, rejecting free-text notes.
   - *Trade-off*: Reduces conversational flexibility, but guarantees zero PII leaks (names, SSN/Aadhaar, emails) to external LLMs.

---

## What I'd Do with More Time

1. **Transactional Outbox Worker**: Introduce an asynchronous Outbox poller (e.g. using Debezium or BullMQ) to publish domain events to Kafka/EventBridge.
2. **AWS S3 Presigned URL Uploads**: Offload large document multipart uploads directly from client browsers to AWS S3 using time-limited presigned PUT URLs with SHA-256 validation.
3. **Double-Entry Ledger Schema**: Expand the `transactions` table into a full double-entry ledger with `ledger_accounts`, `journal_entries`, and `entry_lines` enforcing $\sum \text{Debits} = \sum \text{Credits}$.
4. **OpenTelemetry Tracing**: Implement distributed OpenTelemetry traces across API Gateway, App Nodes, Database, and external payment gateway webhooks.
