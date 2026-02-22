# Monitoring Metrics: GDPR + Call-Event Consent Hardening

**Monitor for 7 days post go-live.**  
**Where to observe:** Application logs, Sentry, DB (gdpr_erase_requests, audit_log).

---

## Counters to Add/Monitor

| Metric | Source | Where to Observe | Suggested Alert |
|--------|--------|------------------|-----------------|
| `sync_204_consent_missing_count` | POST /api/sync returns 204 with x-opsmantik-consent-missing | Logs / metrics backend | None (expected) |
| `call_event_204_consent_missing_count` | POST /api/call-event/v2 returns 204 with header | Logs / metrics backend | None (expected) |
| `call_event_400_consent_fields_rejected_count` | 400 on payload with consent_scopes/consent_at | Logs / metrics backend | Spike > 100/min |
| `replay_reject_count` | ReplayCacheService.checkAndStore → isReplay: true | Logs | Spike > 50/min |
| `fingerprint_rate_limit_count` | 429 on fp: rate limit key | Logs | Spike > 200/min |
| `oci_enqueue_skipped_marketing_missing_count` | enqueueSealConversion / PipelineService reason=marketing_consent_required | Logs | None (expected) |
| `error_rate` for /api/sync | 5xx / total | Logs / APM | > 1% |
| `error_rate` for /api/call-event/v2 | 5xx / total | Logs / APM | > 1% |

---

## Abuse Indicators (Spike = Investigate)

Spikes in these counters may indicate abuse or probing:
- `fingerprint_rate_limit_count` — brute-force session probing
- `replay_reject_count` — replay attempts
- `oci_enqueue_skipped_marketing_missing_count` — correlate with replay/fp; unexpected spike may indicate abuse

---

## Implementation Notes

- **Logs:** Add structured log fields (e.g. `sync_204_consent_missing: 1`) in sync and call-event routes on 204/400/replay/fingerprint-429 paths. Aggregate via log agent (e.g. Datadog, Logtail).
- **Sentry:** Tag errors with `route=sync` or `route=call-event-v2`; filter by tag for error_rate.
- **DB:** `audit_log` for ERASE/EXPORT actions; `gdpr_erase_requests` for erase volume. No new tables required for these counters.

---

## Alert Thresholds (7-Day Lock)

| Alert | Condition | Action |
|-------|-----------|--------|
| sync_error_rate_high | 5xx / sync total > 1% for 5 min | Page on-call |
| call_event_error_rate_high | 5xx / call-event total > 1% for 5 min | Page on-call |
| consent_rejection_spike | call_event_400_consent_fields > 100/min | Investigate abuse |
| replay_spike | replay_reject > 50/min | Investigate replay attempts |
| fingerprint_rl_spike | fingerprint_rate_limit_count > 200/min | Investigate abuse / probing |
| oci_skip_spike | oci_enqueue_skipped_marketing_missing_count spike | May indicate abuse; correlate with replay/fp metrics |
