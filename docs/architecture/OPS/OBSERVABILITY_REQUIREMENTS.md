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
| `oci_enqueue_skipped_marketing_missing_count` | PipelineService / confirm_sale | OCI enqueue skipped due to missing marketing consent |
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
