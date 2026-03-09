# Determinism Contract

**Principle:** Motor tolerates no soft flexibility. Deterministic, strict, no dual-headed predictions. Every value has a counterpart; no null escape hatches in critical paths.

---

## Rules

| Rule | Implementation |
|------|----------------|
| No null fallbacks | conversionTime, value_cents, currency: missing → skip row + log. No `?? 0`, no `?? 'TRY'`, no silent `now()`. |
| No best-effort in critical path | Seal V3/V4 emit, enqueue: fail loud (503/409) on error. No empty `.catch()`. Tracker: `TRACKER_FETCH_FAILED` log; sweep-zombies: `OUROBOROS_ALERT_FAILED` log. |
| Single value SSOT | funnel-kernel value-formula (computeSealedValue, computeExportValue). oci-config delegates. |
| Single export path | call_funnel_projection when export_status=READY; default. USE_FUNNEL_PROJECTION=false = legacy fallback during cutover. |
| Version required for seal | body.version required; 400 if omitted. Optimistic locking enforced. |
| Env secrets | OCI_SESSION_SECRET, VOID_LEDGER_SALT: no empty fallback in production. Log when insecure fallback used. |
| Dual-write atomicity | Ledger and marketing_signals/queue must not diverge. Target: signal + ledger in same transaction (RPC). Current: separate inserts; repair cron if ledger fails. |
| Atomic compensation  | When processSyncEvent fails after idempotency+usage commit: `decrement_and_delete_idempotency` RPC does decrement + delete in one transaction. No separate calls. |
| Idempotency collision| v1: 5s bucket; v2: 10s/2s buckets. Identical (site, event_name, url, fp) in same tick may dedupe. Add `event_id` or QStash messageId to key when available (P2). |
| Orphan calls         | `calls.matched_session_id` has no FK. Match logic enforces same-site; orphans from session delete are edge-case. Soft FK check in RPC (P2). |
| Rate limit Redis down| Phase 5: sync/call-event use `fail-closed`; when Redis unavailable → 503 (rate limit service unavailable). No degraded fallback on ingest. |
| Error sanitization   | providers/credentials/test, reporting/dashboard-stats: `sanitizeErrorForClient(err)`; no raw `err.message` to client in production. |
| Cron auth fail-closed| CRON_SECRET missing/placeholder in production → 403. Hybrid: require x-vercel-cron + Bearer CRON_SECRET in prod. |
| PII redaction        | validate-site-access: hashForLog(userId, siteId, ip). process-call-event: never log phone, fingerprint. Sentry: scrubEventPii in beforeSend. |
| Fail-fast schema     | Sync: parseSignalManifest (Zod) → 422 on invalid. call-event v2: CallEventV2Schema → 400 on missing required. Worker: validate payload shape before process. |
| Circuit breakers     | Google Ads 429: retry with backoff; QStash 5xx: fallback buffer; Supabase 503: doc heavy RPC timeout. P2. |
| Proof of occurrence  | Ledger append-only = proof of sequence; call_actions revert_snapshot = prior state; orderId = Google dedup authority. |
| Entropy (COSMIC)     | ingest_id, batch_id, request_id use crypto.randomUUID(); ledger uses SHA-256. No bill merge from UUID collision. Doc-only. |
| GDPR erase cascade   | erase_pii_rpc: sessions, events, calls, conversations, sales, sync_dlq, ingest_fallback. Ledger/funnel_projection: audit for PII retention; document scope. |
| Redis fencing (P2)   | with-cron-lock: add `next_cron_fence(job_name)` RPC; pass token to mutations; reject if row.cron_fence >= token. Documented; P2. |
| Payload integrity (P3) | Sync unsigned; MITM/SEU in transit. Optional: HMAC(secret, row) in integrity_hash for critical paths. value_cents integer everywhere. P3. |

---

## Client Trust Boundary (Phase 18)

| Item | Current | Target |
|------|---------|--------|
| `sm` (session month) | Client `new Date().toISOString().slice(0,7)+"-01"` | Accept; used for partitioning only. Client sm drift affects partition placement, not billing. |
| Fingerprint | Includes `getTimezoneOffset()` | Accept; TZ is part of device fingerprint. |
| Outbox retry | Same payload retried; no server idempotency key | Client retry can produce duplicate ingest attempts; server dedup by idempotency key. |
| Heartbeat | `setInterval(heartbeat, 60s)` | Heartbeat and sync are independent; acceptable. |

**Rule:** Server must not over-trust client-origin timestamps for billing or dedup. Billing uses server-side `occurred_at`, ledger timestamps.

---

## Related

- [EXPORT_CONTRACT.md](./EXPORT_CONTRACT.md) — Null policy, export shape, orderId collision
- [FUNNEL_CONTRACT.md](./FUNNEL_CONTRACT.md) — Funnel Kernel Charter
- [DB_TRIGGER_ORDER.md](./DB_TRIGGER_ORDER.md) — Trigger catalog and firing order
- [OCI_OPERATIONS_SNAPSHOT.md](../operations/OCI_OPERATIONS_SNAPSHOT.md) — Determinism Contract section
