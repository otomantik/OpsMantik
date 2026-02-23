# Revenue Kernel Spec — Single Source of Truth for Billable Usage

**Purpose:** Establish the single source of truth (SoT) for billable, dispute-proof usage.  
**Scope:** Billable unit definition, idempotency, quota, metering, failure modes, dispute-proofing.

---

## 1) Scope and Non-Goals

**Scope:**
- Deterministic definition of Billable Unit.
- Tenant-based quota (Hard, Soft, Hard Cap).
- Dual-layer metering (Redis = performance, Postgres = financial truth).
- Revenue integrity under failure modes; no data loss.

**Non-Goals:**
- Payment processing (delegate to Stripe).
- Invoice PDF generation.
- Plan selection UI.
- Multi-currency (base: USD).

---

## 2) Glossary

| Term | Definition |
|------|------------|
| **Billable Event** | Event that passes the idempotency gate, is unique, and is successfully written to ingest or buffer. |
| **Duplicate Event** | Event with same payload hash within the idempotency window. Cost: $0. |
| **Hard Limit** | Threshold where quota is exceeded and ingestion is rejected (HTTP 429). Common on Free tier. |
| **Soft Limit** | Ingestion continues; events marked as "Overage". Common on Pro tier. |
| **Hard Cap** | Safety circuit breaker (e.g. 200% of plan); rejection even under Soft Limit plans. |
| **Idempotency Key** | Deterministic hash (SHA-256) derived from event attributes; used for duplicate detection. |
| **Reconciliation** | Correction of Redis counters against authoritative Postgres ledger (async). |
| **Fallback Buffer** | Postgres table where events are written when QStash is unavailable. These events are billable. |

---

## 3) Actors and Tenancy Model

- **Tenant (Site):** Primary billing unit. Quota and usage are strictly scoped to `site_id`.
- **Kernel:** Trusted computation layer that enforces limits.
- **User:** Authenticated member of a tenant; does not accumulate individual usage.

---

## 4) Billable Units (What counts, what never counts)

**Billable (counted):**
- **Standard Ingest:** Validated, non-duplicate event successfully published to QStash.
- **Degraded Ingest:** Event written to `ingest_fallback_buffer` when QStash is down (value delivered by data recovery).
- **Recovered Event:** Event moved from buffer to queue — invoice is cut **at capture time**, not at recovery.

**Non-Billable (not counted):**
- **Duplicate:** Rejected at idempotency gate (HTTP 200, `status: "duplicate"`).
- **Throttled / Quota / Rate-limit:** Rejected due to hard limit or abuse rate limit (HTTP 429).
- **Validation Failures:** Malformed JSON, invalid API key (HTTP 400/401).
- **Internal Traffic:** Health check or synthetic probe (identified by specific header/IP).

**Invoice source of truth (key sentence):**  
*Invoice usage = count of BILLABLE rows in `ingest_idempotency` for the billing month (site_id + month scope). `events` / `sessions` aggregates are for sanity check and drift detection only; invoice count is never derived from them.*

---

## 5) Idempotency Invariants

**Invariant:** Billable Event = Idempotent Event. If the system cannot prove an event is unique, it must not bill for it.

**Key design:**
- **Algorithm:** SHA-256.
- **Input:** `site_id` + `event_name` + `normalized_url` + `session_fingerprint` + `time_bucket`.
- **Time bucket:** `floor(timestamp / 5000)` ms. 5-second window balances dedup with legitimate burst events.

**Flow:**
1. Compute key.
2. Attempt INSERT into `ingest_idempotency` (ON CONFLICT DO NOTHING).
3. Conflict (duplicate) → Return duplicate; do not increment usage.
4. Successful insert → Proceed to quota check.

**Retention (agreed):**  
`ingest_idempotency` records must be retained for at least **1 billing period + dispute window**. Recommended policy: **90 days** or **120 days** (or "current month + previous 2 months"). 24 hours is insufficient for invoice and dispute; implementation must align TTL/archive with this policy.

---

## 6) Metering Architecture (Redis vs Postgres)

- **Redis:** Performance layer only. Not source of truth; no financial risk if lost or reset.
- **Postgres:** Sole authority for invoice and dispute. Reconciliation and invoice count are derived from Postgres (ingest_idempotency).

**Layer 1 – Performance (Redis):**  
Key: `usage:{site_id}:{YYYY-MM}`. GET on ingress, INCR on worker success. Ephemeral.

**Layer 2 – Financial Ledger (Postgres):**  
Table: `site_usage_monthly`. Updated periodically by reconciliation cron using COUNT from `ingest_idempotency` (site_id + month). ACID.

---

## 7) Quota Semantics (hard / soft / cap + response codes + headers)

**Flow (/api/sync):**
1. Idempotency check → if duplicate, return 200 (no billable).
2. Fetch plan & usage (cache/DB): `plan_tier`, `hard_limit`, `soft_limit_enabled`.
3. Evaluate:
   - usage < limit → ALLOW.
   - usage ≥ limit and `soft_limit_enabled`: usage > hard_cap (e.g. limit × 2) → REJECT (429); else ALLOW (Overage).
   - usage ≥ limit and `!soft_limit_enabled` → REJECT (429).

**429 distinction (agreed):**  
429 does not always mean the same thing. Two causes must be distinguishable:
- **Quota exceeded:** `x-opsmantik-quota-exceeded: 1` + `Retry-After` (month rollover / policy).
- **Rate-limit / abuse:** `x-opsmantik-ratelimit: 1` (or equivalent header in current schema).  
This allows dispute resolution to distinguish "quota full" vs "security cutoff" with evidence.

**Response contracts:**

| Status | HTTP | Example headers |
|--------|------|-----------------|
| Allowed (standard) | 200 OK | `x-opsmantik-quota-remaining: 4500`, `x-opsmantik-dedup: 0` |
| Allowed (overage / soft) | 200 OK | `x-opsmantik-quota-remaining: 0`, `x-opsmantik-overage: true`, `x-opsmantik-dedup: 0` |
| Rejected (quota / hard cap) | 429 Too Many Requests | `Retry-After: 3600`, `x-opsmantik-quota-exceeded: 1` |
| Rejected (rate-limit / abuse) | 429 Too Many Requests | `x-opsmantik-ratelimit: 1` |
| Duplicate (non-billable) | 200 OK | `x-opsmantik-dedup: 1`; body `ingest_id` **may be omitted or null**. |
| Degraded (fallback) | 200 OK | `x-opsmantik-degraded: qstash_publish_failed`, `x-opsmantik-fallback: true` |

---

## 8) Dispute-Proofing

For customer disputes ("I did not send 1M events"):

- **Evidence table:** `ingest_idempotency`.
- **Producible evidence:** List of `idempotency_key` + `created_at` for the relevant `site_id` and billing period.
- **Reconcilability:** Row count in `ingest_idempotency` for the billing month matches invoiced amount (±1% drift acceptable for cache/async increment delay; final invoice derived from DB).

---

## 9) Failure Modes

| Component | Ingestion impact | Billing impact | Recovery |
|-----------|------------------|----------------|----------|
| QStash down | Degraded (200), writes to `ingest_fallback_buffer`. | Billable (capture delivers value). | Recovery cron republishes. |
| Redis down | Degraded (200). Quota check falls back to PG snapshot. | Billable. Counters reconciled later. | Conservative mode (reject near Hard Limit). |
| Postgres down | Critical (500). Tenant/idempotency cannot be written. | Non-billable; data not accepted. | Client retry (client-side buffer). |
| Worker crash | Safe via QStash retry. | Idempotency key prevents double billing on retry. | Standard QStash DLQ. |

---

## 10) Data Model (high level)

- **site_plans:** `site_id`, `plan_tier`, `monthly_limit`, `soft_limit_enabled`, `hard_cap_multiplier`.
- **site_usage_monthly (invoice SoT):** `site_id`, `year_month`, `event_count`, `last_synced_at`. Value filled by COUNT from `ingest_idempotency` (site_id + month).
- **ingest_idempotency (gate):** `site_id`, `idempotency_key`, `created_at`. UNIQUE(site_id, idempotency_key). Retention: 90–120 days or current month + previous 2 months (invoice + dispute window).

---

## 11) Security & Abuse Controls

- **Spoofing:** All input requires valid Public API Key with `site_id` resolution.
- **Rate limiting (abuse):** Independent of quota; IP-based (e.g. 100 req/s). Redis/Edge returns 429; may reject before credential verification (cheap). Header: `x-opsmantik-ratelimit: 1`.
- **Overage protection:** Hard Cap prevents unlimited overage on Pro plan with leaked API key.

---

## 12) Observability

**Golden signals:**  
`billing.ingest.allowed`, `billing.ingest.duplicate`, `billing.ingest.rejected_quota`, `billing.ingest.overage`, `billing.reconciliation.drift`.

**Required headers:**  
`x-opsmantik-dedup`, `x-opsmantik-quota-remaining`, `x-opsmantik-overage` (if applicable), `x-opsmantik-quota-exceeded`, `x-opsmantik-ratelimit`, `x-opsmantik-commit`, `x-opsmantik-branch`, `x-opsmantik-degraded`, `x-opsmantik-fallback`.

Watchtower integration: degradation and failure counts align with current patterns.

---

## 13) Acceptance Criteria (PR-1 .. PR-8)

- **PR-1 Schema:** `site_plans`, `site_usage_monthly` with RLS; unique constraints.
- **PR-2 Idempotency:** 200 + `x-opsmantik-dedup: 1` on duplicate; duplicate not sent to QStash; duplicate body `ingest_id` omit or null.
- **PR-3 Quota:** Redis lookup <10ms; Hard limit → 429 + `x-opsmantik-quota-exceeded`; Soft limit → 200 + overage log; 429 distinguishes Quota vs Rate-limit headers.
- **PR-4 Reconciliation:** Worker Redis INCR best-effort; cron updates `site_usage_monthly` from DB count; FOR UPDATE SKIP LOCKED prevents races.
- **PR-5 Failure:** Redis down → accept via PG snapshot; QStash down → accept via Fallback buffer.
- **PR-6 Dispute:** Site-level idempotency list producible for billing period.
- **PR-7 Retention:** ingest_idempotency 90/120 day policy (or current + 2 months).
- **PR-8 Observability:** Above headers and billing metrics.

---

## 14) Open Questions

- **Overage pricing:** Calculated immediately or at month-end? (Recommendation: Month-end, from `site_usage_monthly`.)
- **Existing user migration:** How to initialize limits for Alpha users? (Recommendation: Seed with "Free" plan default.)

---

*This document is locked by four agreements: duplicate ingest_id, invoice SoT, 429 distinction, idempotency retention.*
