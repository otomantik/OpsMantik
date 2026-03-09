# Observability Requirements — OpsMantik Production

**Scope:** Production metrics, thresholds, alert routing, investigation playbooks.
**Sprint A:** Operational proof; no business logic changes.

---

## Core Metrics (Required)

| Metric | Source | Description |
|--------|--------|-------------|
| `sync_error_rate` | 5xx / total for POST /api/sync | Percentage of sync requests returning 5xx |
| `call_event_error_rate` | 5xx / total for POST /api/call-event/v2 | Percentage of call-event requests returning 5xx |
| `replay_noop_count` | 200 + status:noop for call-event | Replay cache hit; no duplicate insert |
| `fingerprint_rate_limit_count` | 429 on fp: rate limit key | Fingerprint brute-force guard triggered |
| `consent_missing_204_count` | 204 + x-opsmantik-consent-missing | Sync or call-event consent gate |
| `oci_enqueue_skipped_marketing_missing_count` | `enqueueSealConversion` / sale reconcile RPC | OCI enqueue skipped due to missing marketing consent |
| `idempotency_insert_count` | Successful idempotency row insert | Billable sync ingestion |
| `duplicate_insert_detected_count` | x-opsmantik-dedup: 1 or duplicate key | Idempotency duplicate; no charge |

---

## Thresholds (7-Day Lock)

| Condition | Threshold | Action |
|-----------|-----------|--------|
| error_rate > 1% | sync or call_event_error_rate | Page on-call |
| replay_noop spike | > baseline × 5 | Investigate abuse |
| consent_missing spike | > baseline × 3 | Investigate consent flow |
| 500 spike | > 0.5% of traffic | Page on-call |

---

## Alert Routing

| Alert | Severity | Channel | On-Call |
|-------|----------|---------|---------|
| sync_error_rate_high | P1 | PagerDuty / Opsgenie | Yes |
| call_event_error_rate_high | P1 | PagerDuty / Opsgenie | Yes |
| replay_noop_spike | P2 | Slack #ops | No (investigate) |
| consent_missing_spike | P2 | Slack #ops | No |
| fingerprint_rl_spike | P2 | Slack #ops | No |

---

## External Dependency Failure Modes (Phase 23)

| Dependency | Failure Mode | Current | Target |
|------------|--------------|---------|--------|
| QStash | Timeout or 5xx | Fallback to ingest_fallback_buffer | Document: fallback path; recovery cron retries. No double-bill. |
| Redis | Down | Rate limit fail-closed (Phase 5) | sync/call-event return 503 when Redis unavailable. |
| Supabase | Connection exhaustion | Pooler port 6543; query timeout 10s | Document in PRO_UPGRADE; apply withQueryTimeout to heavy RPCs. |
| Google Ads API | 429 / quota | Script retries with backoff | Document max retries; DLQ for permanent failures. |

---

## Early-Warning Thresholds (Phase 36)

| Item | Target |
|------|--------|
| Redis | Alert if P99 > 50ms or unavailable; Vercel KV or custom check. |
| DB pool | Alert if connection wait > 2s; Supabase pooler metrics. |
| QStash backlog | Alert if ingest backlog > N; expose via /api/metrics. |
| Export rate | Optional: baseline value_cents/day; alert spike/drop. P2. |

---

## Health Check Gates (Phase 39)

| Gate | Status |
|------|--------|
| smoke:intent-multi-site | Deploy gate in deploy-gate-intent.mdc; 2/2 PASS before deploy. |
| /api/health | If exists: checks DB, Redis; 503 if any down. |
| Contract tests | Optional: schema tests for sync/call-event; build fails on drift. P2. |
| Vercel deploy | Doc: run smoke before deploy; no auto-block. |

---

## Query Timeout Resource Leak (Phase 28)

`withQueryTimeout` rejects when timeout fires; underlying Supabase/Postgres query is **not cancelled**. Connection and query continue until completion. Document: timeout races response; DB query runs to completion. P2: Postgres-level statement_timeout for heavy RPCs.

---

## Trace Propagation (Phase 27)

| Flow | Header / Payload | Target |
|------|------------------|--------|
| Sync route | om-trace-uuid, x-request-id | Pass in QStash payload to worker |
| QStash worker | body.om_trace_uuid | Worker logs with trace; process-sync-event / process-call-event |
| Ledger | correlation_id | Populate from trace when available |

**Rule:** x-request-id and om-trace-uuid propagate across sync → worker → process-sync-event. QStash payload must include trace fields for correlation.

---

## Investigation Playbook

### sync_error_rate_high
1. Check Sentry for route=sync; filter by last 15 min.
2. Check QStash / worker DLQ for sync worker failures.
3. Check Supabase status; verify idempotency table health.
4. If Redis-related: check Upstash status; replay/rate-limit degraded mode.

### call_event_error_rate_high
1. Check Sentry for route=call-event-v2.
2. Verify `verify_call_event_signature_v1` RPC; check Supabase connectivity.
3. Check ReplayCacheService (Redis) for degradation.
4. Verify rate limit keys not exhausting Redis.

### replay_noop_spike
1. Correlate with fingerprint_rate_limit_count and consent_missing.
2. Check for replay abuse (same signature repeated).
3. Verify replay cache TTL and key format (siteId + sha256(signature)).
4. No immediate rollback; monitor for duplicate inserts.

### consent_missing_spike
1. Verify client consent banner / CMP integration.
2. Check sync payload for consent_scopes presence.
3. No code change without product sign-off; may be expected traffic shift.
