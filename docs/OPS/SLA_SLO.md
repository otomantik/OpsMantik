# OpsMantik — SLA/SLO + Measurement Spec

Scope: production only. Window: rolling **28 days** (monthly review cadence).

## Services in scope

| Endpoint | Purpose | Criticality |
|---|---|---|
| `POST /api/sync` | session/event ingestion (producer → QStash worker) | P0 |
| `POST /api/call-event/v2` | high-intent click capture (proxy-first) | P0 |
| `GET /api/health` | liveness + lightweight DB ping | P0 (monitoring dependency) |

## Definitions (SLIs)

**Availability SLI (per endpoint)**  
Availability = \( \frac{\text{successful requests}}{\text{total requests}} \)  
- Successful = HTTP **2xx**  
- Total = all requests excluding client/network errors not reaching Vercel (not measurable here)

**Error-rate SLI (per endpoint)**  
Error rate = \( \frac{\text{server errors}}{\text{total requests}} \)  
- Server errors = HTTP **5xx**

**Latency SLI (per endpoint)**  
p95 latency = 95th percentile of request duration (server-side).

## SLOs (targets)

### `POST /api/sync`

| SLI | SLO target |
|---|---|
| Availability | **≥ 99.90%** |
| 5xx error rate | **≤ 0.50%** |
| p95 latency | **≤ 800 ms** |

Notes:
- `/api/sync` intentionally returns 200 quickly after queueing. If QStash publish fails, it may return a degraded 200; treat that as “available” but investigate via logs/Sentry.

### `POST /api/call-event/v2`

| SLI | SLO target |
|---|---|
| Availability | **≥ 99.90%** |
| 5xx error rate | **≤ 0.50%** |
| p95 latency | **≤ 600 ms** |

Notes:
- This endpoint is expected to be low-latency; it is user-interaction critical.

### `GET /api/health`

| SLI | SLO target |
|---|---|
| Availability | **≥ 99.95%** |
| 5xx error rate | **≤ 0.10%** |
| p95 latency | **≤ 200 ms** |

Notes:
- `db_ok=false` is still a 200 response; availability is about the endpoint responding.
- DB check is timeout-bounded to keep the endpoint responsive.

## Measurement (source of truth)

### Source A — Sentry Performance (latency + error rate)

Use Sentry (server-side) for:
- p95 latency by endpoint (`transaction` / route)
- 5xx error rate (HTTP status buckets + exceptions)

Minimum required env/config:
- `NEXT_PUBLIC_SENTRY_DSN` (or `SENTRY_DSN`)
- `SENTRY_TRACES_SAMPLE_RATE` (recommended baseline: **0.05** in prod)

Operational notes:
- Sample rate impacts accuracy of p95 latency. If you need tighter p95 confidence, raise `SENTRY_TRACES_SAMPLE_RATE` during an incident or for a short audit window.

### Source B — Vercel Logs (availability + error rate)

Use Vercel Logs / Log Explorer for:
- request counts by route
- HTTP status distribution (2xx/4xx/5xx)
- quick correlation with deploy SHA (`VERCEL_GIT_COMMIT_SHA`)

Minimum required:
- Logs enabled for the Vercel project (default).
- Optional: a log drain (Datadog/Logtail/etc.) for longer retention.

## Alerts (minimal, actionable)

Alert routing: page only on fast-burn; otherwise ticket/slack.

### P0 fast-burn alerts (page)

Trigger if **any** condition holds for **5 minutes**:

**`/api/sync`**
- Availability < **99%** OR
- 5xx error rate > **2%** OR
- p95 latency > **2000 ms**

**`/api/call-event/v2`**
- Availability < **99%** OR
- 5xx error rate > **2%** OR
- p95 latency > **1500 ms**

**`/api/health`**
- Availability < **99%** OR
- p95 latency > **1000 ms**

### Slow-burn alerts (ticket)

Trigger if **any** condition holds for **60 minutes**:
- 5xx error rate > **1%** (any endpoint)
- p95 latency exceeds SLO target by **2×** (any endpoint)

## Monthly SLO review (process)

Cadence: first business day of each month (review the last 28 days).

Checklist:
1. **Compute compliance** for each SLO (availability, 5xx, p95) per endpoint.
2. **List breaches** with timestamps (deploy SHA, incident link, root cause).
3. **Classify**: regression vs infra vs third-party vs expected traffic anomaly.
4. **Action items** (max 3): owner + deadline + measurable outcome.
5. **Adjust targets** only if:
   - measured SLIs are stable for 2+ months AND
   - there is clear business justification.

Outputs:
- A short monthly note in `docs/OPS/` (or ticket) with compliance table + actions.

## Minimal changes required (if not already set)

1. **Set Sentry DSN + traces sample rate** in production env:
   - `NEXT_PUBLIC_SENTRY_DSN`
   - `SENTRY_TRACES_SAMPLE_RATE=0.05` (baseline)
2. **Ensure Vercel Logs are accessible** to on-call.
3. (Optional) Add a log drain for retention beyond Vercel defaults.

