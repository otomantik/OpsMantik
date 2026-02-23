# Service Level Objectives (SLO) & Service Level Agreement (SLA)

**Effective Date:** 2026-02-14  
**Scope:** OpsMantik Enterprise Edition (Revenue Kernel)

---

## 1. Service Level Objectives (SLOs) - Internal Targets

These are the engineering targets we strive to hit. Alerts fire if we breach these.

| Category | Metric | Target | Measurement Window |
| :--- | :--- | :--- | :--- |
| **Availability** | API Uptime (`/api/sync`) | **99.5%** | Monthly |
| **Latency** | Ingest Processing (p95) | **< 500ms** | 5-minute rolling |
| **Data Integrity** | Billable Event Capture | **100%** | Infinite (Zero Loss) |
| **Freshness** | Dashboard Real-time Lag | **< 5s** | 99% of time |
| **Accuracy** | Billing Reconciliation | **±0.0%** | Monthly Close |

### Definitions

- **Availability:** Percentage of strict `5xx` errors. (`4xx` and `429` are NOT errors).
- **Data Integrity:** Count of `(Accepted + Overlimit + Degraded)` events must exactly match `ingest_idempotency` rows. "Fallback" events count as captured.
- **Billing Accuracy:** Deviation between `site_usage_monthly` (Invoice) and `ingest_idempotency` (Ledger).

---

## 2. Service Level Agreement (SLA) - Customer Commitments

These are the strict guarantees provided to Enterprise customers. Breaching these may result in service credits.

### 2.1. Ingestion Reliability
**Guarantee:** OpsMantik will accept and persist 99.9% of valid, authenticated, within-quota requests.
**Exclusions:**
- Requests rejected due to Rate Limit (Security) or Quota (Business).
- Invalid payloads (400).
- Scheduled maintenance windows (communicated 48h in advance).

### 2.2. Data Durability
**Guarantee:** **Zero Data Loss** for acknowledged requests (HTTP 200).
**Mechanism:** 
- If the primary queue (QStash) is down, events are synchronously written to the `ingest_fallback_buffer` (Postgres).
- Fallback events are processed within 24 hours.

### 2.3. Operational Support
**Guarantee:** Critical Severity (P0) Response Time < 2 hours.

| Severity | Definition | Response Target | Resolution Target |
| :--- | :--- | :--- | :--- |
| **P0 (Critical)** | Data ingestion totally down; Data loss risk. | < 2 hours | < 8 hours |
| **P1 (High)** | Dashboard inaccessible; billing drift > 5%. | < 4 hours | < 24 hours |
| **P2 (Normal)** | Minor UI bugs; drift < 1%. | < 24 hours | Next Business Day |

---

## 3. Error Budget & Refund Policy

- **Uptime < 99.9%:** 10% credit of monthly fee.
- **Uptime < 99.0%:** 25% credit of monthly fee.
- **Data Loss:** 100% credit of monthly fee + contract termination right.

---

## 4. Monitoring & Reporting

- **Status Page:** `status.opsmantik.com`
- **Billing Transparency:** Customers can export their raw billing ledger via `GET /api/billing/dispute-export` at any time to verify invoice accuracy.
