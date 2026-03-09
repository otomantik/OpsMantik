# Determinism Contract

**Principle:** Motor tolerates no soft flexibility. Deterministic, strict, no dual-headed predictions. Every value has a counterpart; no null escape hatches in critical paths.

---

## Rules

| Rule | Implementation |
|------|----------------|
| No null fallbacks | conversionTime, value_cents, currency: missing → skip row + log. No `?? 0`, no `?? 'TRY'`, no silent `now()`. |
| No best-effort in critical path | Seal V3/V4 emit, enqueue: fail loud (503/409) on error. No empty `.catch()`. |
| Single value SSOT | funnel-kernel value-formula (computeSealedValue, computeExportValue). oci-config delegates. |
| Single export path | call_funnel_projection when export_status=READY; default. USE_FUNNEL_PROJECTION=false = legacy fallback during cutover. |
| Version required for seal | body.version required; 400 if omitted. Optimistic locking enforced. |
| Env secrets | OCI_SESSION_SECRET, VOID_LEDGER_SALT: no empty fallback in production. Log when insecure fallback used. |
| Dual-write atomicity | Ledger and marketing_signals/queue must not diverge. Target: signal + ledger in same transaction (RPC). Current: separate inserts; repair cron if ledger fails. |
| Atomic compensation  | When processSyncEvent fails after idempotency+usage commit: `decrement_and_delete_idempotency` RPC does decrement + delete in one transaction. No separate calls. |
| Idempotency collision| v1: 5s bucket; v2: 10s/2s buckets. Identical (site, event_name, url, fp) in same tick may dedupe. Add `event_id` or QStash messageId to key when available (P2). |
| Orphan calls         | `calls.matched_session_id` has no FK. Match logic enforces same-site; orphans from session delete are edge-case. Soft FK check in RPC (P2). |
| Rate limit Redis down| Phase 5: sync/call-event use `fail-closed`; when Redis unavailable → 503 (rate limit service unavailable). No degraded fallback on ingest. |

---

## Related

- [EXPORT_CONTRACT.md](./EXPORT_CONTRACT.md) — Null policy, export shape
- [FUNNEL_CONTRACT.md](./FUNNEL_CONTRACT.md) — Funnel Kernel Charter
- [OCI_OPERATIONS_SNAPSHOT.md](../operations/OCI_OPERATIONS_SNAPSHOT.md) — Determinism Contract section
