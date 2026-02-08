# OpsMantik — SLA & SLO Specification

**Last Updated:** 2026-02-08  
**Owner:** Principal SRE Team  
**Review Cadence:** Monthly

This document defines Service Level Indicators (SLIs), Service Level Objectives (SLOs), alert thresholds, and measurement sources for the OpsMantik platform. All SLOs use a **28-day rolling window** unless otherwise stated. Alert windows are **5 minutes** (paged) or **1 hour** (ticket) as specified per endpoint.

---

## 1. In-Scope Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/sync` | Event and session ingestion (tracker). |
| POST | `/api/call-event/v2` | Conversion signal ingestion (call/WhatsApp events). |
| GET | `/api/health` | Public health and readiness check. |

---

## 2. POST /api/sync

### 2.1 SLIs

| SLI | Definition | Unit |
|-----|------------|------|
| **Availability** | `(count of responses with status 2xx) / (count of valid requests)` over the measurement window. Valid requests exclude requests with invalid or missing required headers/body. Client errors (4xx) are excluded from the denominator. Responses with status 429 count as availability failures and are tracked separately as Throttle rate. | Percent |
| **Error rate** | `(count of responses with status 5xx) / (count of valid requests)` over the measurement window. | Percent |
| **Throttle rate** | `(count of responses with status 429) / (count of valid requests)` over the measurement window. Tracked separately for visibility; 429 is an availability failure for valid requests. | Percent |
| **Latency (p95)** | 95th percentile of response duration (time to first byte or equivalent) for successful (2xx) responses. | Milliseconds |

### 2.2 SLO Targets (28-day rolling)

| SLI | SLO Target |
|-----|------------|
| Availability | ≥ 99.9% |
| Error rate | ≤ 0.1% |
| Throttle rate | Tracked; see alert thresholds. |
| Latency (p95) | ≤ 300 ms |

### 2.3 Alert Thresholds

Percent-based availability paging applies only when **valid_requests ≥ 50** in the 5-minute window. When valid_requests &lt; 50, page on absolute count: **5xx count ≥ 5** within 5 minutes.

| Severity | Condition | Time window | Action |
|----------|-----------|------------|--------|
| Paged (critical) | Availability &lt; 99.5% (when valid_requests ≥ 50), OR 5xx count ≥ 5 (when valid_requests &lt; 50) | 5 minutes | Page on-call. |
| Paged (critical) | p95 latency &gt; 1000 ms | 5 minutes | Page on-call. |
| Ticket (warning) | Availability &lt; 99.8% | 1 hour | Open incident ticket. |

### 2.4 Measurement Sources

- **Vercel logs:** Request count, status codes, edge duration. Primary for availability and error rate.
- **Sentry (transactions):** Sample for p95 and outlier analysis. Filter by `transaction.op:http.server` and URL containing `/api/sync`.

---

## 3. POST /api/call-event/v2

### 3.1 SLIs

| SLI | Definition | Unit |
|-----|------------|------|
| **Availability** | `(count of responses with status 2xx) / (count of valid requests)` over the measurement window. Valid requests exclude malformed or unauthorized requests. Client errors (4xx) are excluded from the denominator. Responses with status 429 count as availability failures and are tracked separately as Throttle rate. | Percent |
| **Error rate** | `(count of responses with status 5xx) / (count of valid requests)` over the measurement window. | Percent |
| **Throttle rate** | `(count of responses with status 429) / (count of valid requests)` over the measurement window. Tracked separately for visibility; 429 is an availability failure for valid requests. | Percent |
| **Latency (p95)** | 95th percentile of response duration for successful (2xx) responses. | Milliseconds |

### 3.2 SLO Targets (28-day rolling)

| SLI | SLO Target |
|-----|------------|
| Availability | ≥ 99.95% |
| Error rate | ≤ 0.05% |
| Throttle rate | Tracked; see alert thresholds. |
| Latency (p95) | ≤ 500 ms |

### 3.3 Alert Thresholds

Percent-based availability paging applies only when **valid_requests ≥ 10** in the 5-minute window. When valid_requests &lt; 10, page on absolute count: **5xx count ≥ 5** within 5 minutes.

| Severity | Condition | Time window | Action |
|----------|-----------|------------|--------|
| Paged (critical) | Availability &lt; 99.0% (when valid_requests ≥ 10), OR 5xx count ≥ 5 (when valid_requests &lt; 10) | 5 minutes | Page on-call. |
| Ticket (warning) | p95 latency &gt; 800 ms for &gt; 10% of traffic | 1 hour | Open incident ticket. |

### 3.4 Measurement Sources

- **Vercel logs:** Request count, status codes, edge duration. Primary for availability and error rate.
- **Sentry (transactions):** Sample for p95 and outlier analysis. Filter by `transaction.op:http.server` and URL containing `/api/call-event/v2`.

---

## 4. GET /api/health

### 4.1 SLIs

| SLI | Definition | Unit |
|-----|------------|------|
| **Availability** | `(count of responses with status 200) / (count of requests)` over the measurement window. | Percent |
| **Error rate** | `(count of responses with status 5xx) / (count of requests)` over the measurement window. | Percent |
| **Latency (p95)** | 95th percentile of response duration for successful (2xx) responses. | Milliseconds |

### 4.2 SLO Targets (28-day rolling)

| SLI | SLO Target |
|-----|------------|
| Availability | ≥ 99.9% |
| Error rate | ≤ 0.1% |
| Latency (p95) | ≤ 200 ms |

### 4.3 Alert Thresholds

| Severity | Condition | Time window | Action |
|----------|-----------|------------|--------|
| Paged (critical) | Availability &lt; 99.5% | 5 minutes | Page on-call. |
| Ticket (warning) | Availability &lt; 99.8% | 1 hour | Open incident ticket. |

### 4.4 Measurement Sources

- **Vercel logs:** Request count, status codes, edge duration.
- **Sentry (transactions):** Sample for p95. Filter by `transaction.op:http.server` and URL containing `/api/health`.

---

## 5. Security Preconditions

For **enterprise production** deployments, the following precondition is required:

- **Call-event signing:** The environment variable `CALL_EVENT_SIGNING_DISABLED` **MUST** be set to `false` (or unset). Unsigned call-event mode MUST NOT be enabled in enterprise production unless part of a controlled, documented rollout with explicit risk acceptance.

When `CALL_EVENT_SIGNING_DISABLED` is enabled, the platform accepts unsigned requests to call-event endpoints subject to CORS allowlist and rate limiting only. This reduces assurance for conversion signal integrity and is not acceptable as the default for enterprise production.

- **Runbook:** Procedures for enabling or disabling signing, and for controlled rollout of unsigned mode, will be documented in a dedicated runbook. Placeholder: see *Runbook: Call-Event Signing and Unsigned Rollout* (to be published).

---

## 6. Measurement and Sampling

### 6.1 Sources

- **Vercel logs:** Primary source for request counts, HTTP status codes, and latency (edge duration) for all three endpoints.
- **Sentry:** Performance transactions and error events. Used for p95 calculation and root-cause analysis. Configure filters per endpoint as noted in sections 2.4, 3.4, and 4.4.

### 6.2 Exclusions

- **Bot traffic:** Exclude requests where the User-Agent matches common bot/crawler patterns (e.g. `bot`, `crawl`, `spider`) from latency and availability SLI calculations to avoid skew.
- **Client aborts:** Exclude HTTP 499 (client closed request) from availability error counts.
- **Cold starts:** Serverless cold starts may temporarily increase p95. They are accepted in early production; sustained elevation over the alert window should trigger alerts as defined above.

---

## 7. Operational Policies

### 7.1 Monthly SLO Review

- **When:** First Monday of each month.
- **Scope:** Review 28-day error budget consumption for each endpoint. Adjust SLO targets only when consistently met (tighten) or repeatedly missed (relax only with documented remediation).

### 7.2 Error Budget Policy

- **Green (budget &gt; 20%):** Normal feature and change cadence.
- **Yellow (budget &lt; 20%):** Freeze non-critical changes; prioritize reliability work.
- **Red (budget exhausted):** Code freeze on non-reliability work until budget recovers within the rolling window.

### 7.3 Change Management

Any change to processing logic (e.g. session or event identity, ingestion path) must:

1. Update this document if SLI or SLO definitions change.
2. Include a pre-deploy smoke check covering the affected endpoint(s).
3. Include a post-deploy check that p95 latency has not regressed beyond SLO.
