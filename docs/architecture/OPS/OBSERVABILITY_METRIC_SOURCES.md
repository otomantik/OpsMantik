# Metric sources — 1:1 mapping (requirements → reality)

**Companion:** [OBSERVABILITY_REQUIREMENTS.md](./OBSERVABILITY_REQUIREMENTS.md), [OBSERVABILITY_BASELINE.md](./OBSERVABILITY_BASELINE.md)

This document maps each **required** metric to **concrete** observation paths (code, logs, DB, or external).

---

## Core metrics

| Requirement key | Description | Primary source | How to compute / query |
|------------------|-------------|----------------|------------------------|
| `sync_error_rate` | 5xx / total POST `/api/sync` | **Primary:** [`GET /api/metrics`](../../../app/api/metrics/route.ts) → `routes.sync.approx_server_error_rate` + band counters (`route_sync_http_5xx` / `route_sync_requests_total`). **Rolling 15m:** Vercel logs or log drain. |
| `call_event_error_rate` | 5xx / total POST call-event v2 | **Primary:** `routes.call_event_v2` in `/api/metrics`. **Rolling 15m:** Vercel logs. |
| `replay_noop_count` | Replay cache hit (no duplicate insert) | **Route logs** + response contract | Filter responses where handler returns noop (see call-event v2 implementation). |
| `fingerprint_rate_limit_count` | 429 on fingerprint RL | **Logs** | HTTP 429 where message/key indicates fp RL ([`lib/rate-limit`](../../../lib/rate-limit.ts) / sync gates). |
| `consent_missing_204_count` | 204 + consent missing | **Logs / headers** | Count 204 with `x-opsmantik-consent-missing` if set ([`lib/gdpr/consent-check`](../../../lib/gdpr/consent-check.ts) consumers). |
| `oci_enqueue_skipped_marketing_missing_count` | OCI skip (marketing consent) | **Sentry** + code path | Search `enqueueSealConversion` / `OCI` tags; grep [`lib/oci/enqueue-seal-conversion`](../../../lib/oci/enqueue-seal-conversion.ts). |
| `idempotency_insert_count` | Successful idempotency insert | **DB** + **billing** | `ingest_idempotency` table growth; [`getBillingMetrics`](../../../app/api/metrics/route.ts) ingest counters. |
| `duplicate_insert_detected_count` | Dedup hit | **Response** | Header `x-opsmantik-dedup` or worker handling duplicate key. |

---

## Thresholds → alert wiring

| Condition (from requirements) | Suggested signal | Channel (target) |
|------------------------------|------------------|------------------|
| error_rate > 1% (sync or call-event) | `routes.*.approx_server_error_rate` trend + Vercel 15m logs | P1 → PagerDuty/Opsgenie |
| replay_noop > baseline × 5 | Baseline from weekly average | P2 → Slack |
| consent_missing > baseline × 3 | 204 consent-missing count | P2 → Slack |
| 500 spike > 0.5% traffic | Same as error_rate | P1 |

**Implementation note:** Configure monitors in Vercel Observability, Datadog, or Grafana Loki depending on where logs are shipped. Until a single metric API exists, **document the log query** in the alerting tool as the source of truth.

---

## Existing internal metrics API

[`GET /api/metrics`](../../../app/api/metrics/route.ts) (cron-auth) returns:

- `routes.sync` / `routes.call_event_v2` — HTTP band counters + `approx_server_error_rate` ([`lib/route-metrics`](../../../lib/route-metrics.ts))
- `billing.ingest` — Redis-backed ingest counters (cross-instance)
- `billing.reconciliation` — last 24h reconciliation jobs
- `watchtower` — diagnostic status
- `funnel_kernel` — ledger/projection/queue counts

---

## Health checks

| Gate | Source |
|------|--------|
| `smoke:intent-multi-site` | [`docs/OPS/DEPLOY_GATE_INTENT.md`](../../OPS/DEPLOY_GATE_INTENT.md), `npm run smoke:intent-multi-site` |
| `/api/health` | [`app/api/health/route.ts`](../../../app/api/health/route.ts) |

---

## External dependencies

See **External Dependency Failure Modes** table in [OBSERVABILITY_REQUIREMENTS.md](./OBSERVABILITY_REQUIREMENTS.md). Redis/QStash/Supabase/Google Ads behaviors are documented there; link runbooks from PagerDuty playbooks when alerts go live.
