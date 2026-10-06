# Tasks 4 & 5: Payment Processing Flow & Webhook Idempotency

## 1. Overview & Payment Flow (Task 4)

In financial applications, **client assertions of payment success cannot be trusted**. The payment lifecycle follows a strict server-driven state machine:

```
[Customer Intent] ──► POST /api/v1/payments/create
                              │
                              ▼
                      [Status: PENDING] (Saved to PostgreSQL Ledger)
                              │
                              ▼
                    [Payment Gateway Checkout]
                              │
               +──────────────┴──────────────+
               │                             │
               ▼                             ▼
    [Signed Webhook: Succeeded]    [Signed Webhook: Failed]
               │                             │
               ▼                             ▼
       [Status: SUCCESS]             [Status: FAILED]
```

### State Machine Transition Rules:
- **`PENDING`**: Initial state upon order generation. The transaction record exists with `amount_minor` (`BIGINT`), `currency`, and an optional `idempotency_key`.
- **`SUCCESS`**: Only transitioned after server-side cryptographic HMAC-SHA256 signature verification and row-level lock acquisition.
- **`FAILED`**: Explicitly set when the gateway confirms charge rejection or timeout.
- **Terminal State Lock**: Once a transaction reaches `SUCCESS` or `FAILED`, no further status transitions are allowed.

---

## 2. Duplicate Webhook Handling & Idempotency (Task 5)

### 2.1 The Problem
Payment gateways (e.g., Stripe, Razorpay) use **at-least-once delivery**. Due to network retries, transient timeouts, or concurrency, the webhook endpoint `POST /api/v1/webhooks/payment` may receive identical webhook events multiple times simultaneously.

Without idempotency protections, duplicate deliveries cause:
- Double balance credits or double order fulfillment.
- Race conditions corrupting ledger state.
- Inconsistent transaction audit histories.

---

### 2.2 The Solution: PostgreSQL-First Concurrency & Inbox Pattern

We implement a two-tier database-enforced idempotency architecture:

```
[Incoming Webhook Delivery]
            │
            ▼
1. HMAC Signature Verification (`crypto.timingSafeEqual`)
   - Rejects forged payloads with HTTP 401.
            │
            ▼
2. Inbox Pattern (`webhook_events` Table)
   - `INSERT INTO webhook_events (event_id, raw_payload, processing_status)`
   - `VALUES ($1, $2, 'RECEIVED')`
   - `ON CONFLICT (event_id) DO NOTHING`
   
   - If row was NOT inserted: Event ID already exists (duplicate) ──► Return HTTP 200 OK immediately.
            │
            ▼
3. PostgreSQL Transaction with Row-Level Lock (`SELECT FOR UPDATE`)
   - `BEGIN;`
   - `SELECT * FROM transactions WHERE reference_id = $1 FOR UPDATE;`
   
   - Check current transaction status:
     - If `status == 'SUCCESS'` or `status == 'FAILED'`:
       Transaction already finalized ──► `COMMIT;` Return HTTP 200 OK (`{ duplicate: true }`).
     - If `status == 'PENDING'`:
       `UPDATE transactions SET status = $newStatus, gateway_tx_id = $gtxId, updated_at = NOW();`
       `UPDATE webhook_events SET processing_status = 'PROCESSED', processed_at = NOW();`
       `INSERT INTO audit_logs ...;`
       `COMMIT;` ──► Return HTTP 200 OK (`{ duplicate: false }`).
```

---

### 2.3 Error Handling & Gateway Retry Protocol
1. **Database Offline / Transient Outage**: Returns `HTTP 500 Internal Server Error` so the payment gateway backs off and retries delivery later.
2. **Duplicate Deliveries**: Returns `HTTP 200 OK` with `{ duplicate: true }` to acknowledge receipt and halt gateway retry spam.
3. **Late Retries**: The system accepts delayed webhooks as long as the HMAC signature is valid, relying on PostgreSQL row-level locks and idempotency to prevent state corruption.
