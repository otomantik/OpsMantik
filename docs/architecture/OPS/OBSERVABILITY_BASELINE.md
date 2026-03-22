# Observability Baseline — OpsMantik

**Purpose:** Measure progress toward the 78→90 quality plan. Update this document when wiring metrics or changing CI.

**Related:** [OBSERVABILITY_REQUIREMENTS.md](./OBSERVABILITY_REQUIREMENTS.md)

---

## 1. Core metrics checklist

| Metric (from requirements) | Implementation status | Where to observe |
|-----------------------------|----------------------|------------------|
| `sync_error_rate` | **Wired (approx)** — `route_sync_http_5xx / route_sync_requests_total` via Redis + [`GET /api/metrics`](../../../app/api/metrics/route.ts) `routes.sync` | For **short windows**, still use Vercel logs; counters are monotonic (see `routes.*.note`). |
| `call_event_error_rate` | **Wired (approx)** — same for `routes.call_event_v2` | Same as sync |
| `replay_noop_count` | **Partial** — response body / status | Logs: HTTP 200 + body or header indicating noop for call-event replay path |
| `fingerprint_rate_limit_count` | **Partial** | HTTP 429 + rate-limit key containing `fp` (see sync/call-event routes) |
| `consent_missing_204_count` | **Partial** | HTTP 204 + `x-opsmantik-consent-missing` response header (if present) |
| `oci_enqueue_skipped_marketing_missing_count` | **App / DB** | Sentry breadcrumbs + `enqueueSealConversion` logs; optional DB audit via RPC callers |
| `idempotency_insert_count` | **DB / metrics** | `ingest_idempotency` inserts; billing counters in [`/api/metrics`](../../../app/api/metrics/route.ts) (`billing.ingest`) |
| `duplicate_insert_detected_count` | **Partial** | Response header `x-opsmantik-dedup` or duplicate-key handling in sync worker |

**Legend:** Partial = not yet a single named time-series in one dashboard; operable via logs + DB.

---

## 2. Platform endpoints (current code)

| Endpoint | Role |
|----------|------|
| [`GET /api/health`](../../../app/api/health/route.ts) | Liveness: `ok`, `ts`, optional `git_sha`, `db_ok` (anon `ping` RPC) |
| [`GET /api/metrics`](../../../app/api/metrics/route.ts) | **Auth:** cron secret. Billing ingest (Redis/memory), reconciliation, Watchtower, funnel_kernel counts |

**Implemented:** `/api/metrics` exposes `routes.sync` and `routes.call_event_v2` with per-band counters and `approx_server_error_rate` (5xx/total). **Gap:** not a rolling 15-minute window — use Vercel log drains for precise SLO windows or add time-bucketed keys later.

---

## 3. CI baseline (reference)

| Workflow | File | Typical scope |
|----------|------|----------------|
| CI | [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) | lint, i18n, `npm run build` |
| Release gates | [`.github/workflows/release-gates.yml`](../../../.github/workflows/release-gates.yml) | `release:evidence:pr` on PR; full `release:evidence` on push (needs Supabase secrets) |

**Target duration (aspirational):** &lt;15–20 min for full release-gates job when secrets are warm.

**How to record timings:** GitHub Actions → workflow run → job duration. Paste last 5 main-branch medians here when auditing.

| Date | CI (lint+build) | Release gates | Notes |
|------|-----------------|---------------|-------|
| _fill on review_ | | | |

---

## 4. Flaky test inventory

**Policy:** No retry loops masking flakiness in `test:release-gates`; fix root cause (timers, Redis mocks, DB ordering).

| Test file / area | Flaky? | Last note |
|-------------------|--------|-----------|
| _none filed_ | | Re-run failed jobs and file issues if the same test fails intermittently |

---

## 5. Next actions (short)

1. Wire Vercel log-based or metrics-based ratios to [OBSERVABILITY_METRIC_SOURCES.md](./OBSERVABILITY_METRIC_SOURCES.md).
2. Add Sentry saved searches per [SENTRY_INVESTIGATION.md](./SENTRY_INVESTIGATION.md).
3. Revisit this checklist quarterly.
