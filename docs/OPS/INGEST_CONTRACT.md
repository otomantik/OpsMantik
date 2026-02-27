# Ingest Contract

Defines the response contract for `/api/sync` and the decision contract for `/api/workers/ingest`.

## /api/sync Response Contract

| Condition | Status | When |
|-----------|--------|------|
| Auth/site invalid | 400 | `validateSite` fails |
| Rate limit exceeded | 429 | `x-opsmantik-ratelimit: 1`, `Retry-After` |
| Consent missing (analytics) | 204 | `x-opsmantik-consent-missing: analytics`; no publish |
| Parse/validation error | 400 | Invalid payload |
| QStash publish success | 202 | `status: queued`, publishes to worker |
| QStash publish failed (all degraded) | 503 | `x-opsmantik-degraded`, `x-opsmantik-fallback` |

**Order (sync route):** Auth (validateSite) → Rate limit → Consent gate → Publish to QStash → 202.

Sync does **not** perform idempotency, quota, or entitlements checks. Those run in the worker.

## /api/workers/ingest Decision Contract

**Order (worker):** validateSite → Idempotency (tryInsert) → Quota/Entitlements → processSyncEvent / processCallEvent.

| Decision | Response | Headers/Fields |
|----------|----------|----------------|
| Duplicate (idempotency) | 200 JSON `{ ok: true, dedup: true }` | — |
| Quota reject | 200 JSON `{ ok: true, reason }` | — (worker does not set x-opsmantik-quota-exceeded on response; quota is sync-gates internal) |
| Idempotency DB error | 200 JSON `{ ok: true, reason }` | Logs BILLING_GATE_CLOSED |
| Entitlements reject | 200 JSON `{ ok: true, reason }` | — |
| Success | 200 JSON `{ success: true, score/call_id }` | — |

**Dedup:** Sync-gates returns `reason: 'duplicate'` when tryInsert detects existing key. Worker acks without publishing further.

**Quota/Entitlements:** Evaluated in `runSyncGates` after idempotency insert. On reject, `updateIdempotencyBillableFalse` is called before return.

**23505 (unique violation):** Worker treats 23505 as non-retryable; does not retry, may write to DLQ.
