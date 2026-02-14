# Tier-1 Technical Due Diligence: OpsMantik Revenue Kernel & Architecture

**Auditor:** Principal SaaS Architect (ex-Stripe/AWS)  
**Date:** 2026-02-14  
**Target:** OpsMantik Revenue Kernel (v2.1.0)  
**Reference Spec:** `docs/BILLING/REVENUE_KERNEL_SPEC.md`  
**Evidence Base:** `docs/AUDIT/OPSMANTIK_SYSTEM_AUDIT_REPORT.md`

---

## 1. Executive Summary & Market Position

**Current Status:** **Production Beta** (NOT Enterprise Grade yet).

OpsMantik has implemented a scientifically sound "Revenue Kernel" that adheres to the "Ledger-First" principle. The pipeline ensures **zero data loss** and **billable integrity** via a strict firewall (`Auth → RateLimit → Idempotency → Quota → Publish`).

However, it is **not yet Enterprise Ready** due to critical gaps in "Financial Finality" (Invoice Freezing) and "Dispute Resolution" (Evidence Export). While the *data* is safe, the *business logic* to defend that data in a court of law or against a procurement audit is missing.

**The Technical "Moat":**
1.  **Ledger-First Truth:** Billing is derived solely from the `ingest_idempotency` Postgres table, not ephemeral Redis counters.
2.  **Fail-Secure Gate:** The API returns `500` if it cannot prove idempotency insertion, preventing "ghost" billable events.
3.  **Zero-Loss Fallback:** The "QStash Down" scenario is handled via a synchronous write to `ingest_fallback_buffer`, guaranteeing durability even when the queue fails.
4.  **Semantic 429s:** Clear distinction between `Quota Exceeded` (Business) and `Rate Limited` (Security) via headers.

---

## 2. The Scorecard

| Category | Score | Analysis |
| :--- | :--- | :--- |
| **Data Integrity** | **8/10** | Strong foundations (Idempotency + Fallback + PG Source-of-Truth). Deduplication is dual-layer. **Gap:** No proof that `ingest_idempotency` retention cleanup actually runs (risk of bloat). |
| **Multi-Tenant Security** | **8/10** | RLS proven via `tenant-rls-proof.test.ts`. CORS is fail-closed. Cron jobs require strict auth. **Gap:** Missing RBAC for billing endpoints (admin-only export). |
| **Financial Maturity** | **6/10** | The "Billing Engine" works, but the "Finance Engine" is missing. No `Dispute Export` (CSV/Evidence) and no `Invoice Freeze` (Month-end locking). |
| **Operational Maturity** | **7/10** | `Watchtower` is excellent ("Dead Man's Switch"). Runbooks exist (`RUNBOOK_QSTASH_DEGRADED.md`). **Gap:** No `/api/metrics` endpoint or defined SLO document. |
| **Scalability** | **5/10** | **Critical Weakness.** In-memory metrics will fail in serverless. No partitioning on the critical `ingest_idempotency` table. No global backpressure mechanism. |
| **OVERALL SCORE** | **70/100** | **Passable for Beta, Fail for IPO.** Mechanically sound, operationally immature. |

---

## 3. The "Good" (Core Strengths)

### 3.1. Ledger-First Billing Authority
Using Postgres (`ingest_idempotency`) as the **only** source of truth for invoicing is world-class. Redis is correctly treated as a volatile optimization. This eliminates "split-brain" billing issues common in distributed systems.

### 3.2. Strict Pipeline Ordering
The sequence in `/api/sync` is correct and fail-secure:
1.  **Auth & Rate Limit:** Reject cheap/malicious traffic first.
2.  **Idempotency Insert:** "Billable" status is committed *before* work begins.
3.  **Quota Check:** Business logic applied on the committed row.
4.  **Publish:** Async dispatch.
*If step 2 fails, the request fails 500. We never publish work we haven't billed/tracked.*

### 3.3. Failure-Proof Ingestion
The fallback mechanism is robust. If `QStash.publish` throws, the system:
1.  Catches the error.
2.  Writes payload to `ingest_fallback_buffer` (Postgres).
3.  Returns `200 OK` with `x-opsmantik-degraded: qstash_publish_failed`.
*Result:* User data is saved, billing is accurate (billable event captured), and the client does not retry (preventing double-billing).

### 3.4. Concurrency Safe Reconciliation
The `reconcile-usage` job uses `FOR UPDATE SKIP LOCKED` on the job table. This is the gold standard for preventing race conditions in distributed workers.

---

## 4. The "Bad" (Critical Gaps & Risks)

### 4.1. Missing Dispute Resolution (Design vs. Implementation)
*   **Status:** Design allows for reconstruction of billing from `idempotency_key` + `created_at`.
*   **Gap:** There is **NO** endpoint (`GET /api/billing/dispute-export`) to actually generate this evidence for a customer.
*   **Risk:** If a customer claims "I didn't send 1M events", you have to manually run SQL queries. In Enterprise, this is unacceptable; it must be a self-serve or support-tool feature.

### 4.2. No Invoice Freeze
*   **Status:** `site_usage_monthly` exists.
*   **Gap:** There is no mechanism to "Close the Books". We need a `freeze_invoice` job that hashes the month's usage and writes it to an immutable `invoices` table.
*   **Risk:** Usage can technically change after the month ends (e.g., late arriving events, manual DB edits). Auditors hate this.

### 4.3. Unproven Lifecycle Management
*   **Status:** Spec says "90 days retention".
*   **Gap:** No automated test proves that `ingest_idempotency` rows are actually deleted.
*   **Risk:** Table bloat. At 1.000 req/s, this table will reach 250M rows/month. Without aggressive cleanup, the DB will choke within a quarter.

---

## 5. The "Ugly" (Technical Debt)

### 5.1. Missing Partitioning on `ingest_idempotency`
The `ingest_idempotency` table is the hottest table in the system (1 write per request). It **MUST** be partitioned by `created_at` (Range Partitioning). Currently, it appears to be a standard Heap table. At scale (10x), index maintenance will stall writes.

### 5.2. In-Memory Metrics
`billing-metrics.ts` uses local variables (`let allowed = 0`). In a serverless environment (Next.js / Vercel), these variables are reset on every cold start and are not shared across isolates. These metrics are effectively random noise and useless for alerting.

### 5.3. No Global Backpressure
There is no mechanism to shed load if the DB is overwhelmed. The API will keep trying to write to Postgres until connection pools exhaust. Valid rate limiting helps, but "Emergency Shedding" (dropping requests when DB latency > 500ms) is missing.

---

## 6. Strategic Recommendations (The Path to 90+)

### Step 1: Close the Audit Loop (High Leverage)
**Ship the "Financial Finality" features.**
1.  Implement `GET /api/billing/dispute-export?month=2026-01` (Output: CSV of Idempotency Keys).
2.  Implement `POST /api/cron/billing/freeze` (Action: Snapshot `site_usage_monthly` → `invoices`).
*Why:* This converts the "Theoretical" data integrity into "Tangible" business value.

### Step 2: Observability & SLOs
**Move metrics out of memory.**
1.  Define a simple SLO document (e.g., "99.9% availability", "Ingest Latency < 200ms").
2.  Expose strict metrics via an authenticated `/api/monitor/metrics` endpoint that reads from DB/Redis snapshots, not memory.

### Step 3: Lifecycle Automation
**Prove the garbage collection.**
1.  Implement the `delete_expired_idempotency` cron job (DELETE WHERE created_at < NOW - 90 DAYS).
2.  Add a test case that inserts an old row and asserts it vanishes after the job runs.
