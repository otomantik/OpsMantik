# EXTINCTION DOSSIER — Abyssal Chaos Architect Audit

**Date:** 2026-02-25  
**Scope:** Deep architecture scan for distributed systems anomalies, state machine corruptions, and cryptographic/temporal exploits  
**Methodology:** Split-brain simulation, poison-pill injection, circular deadlock analysis, idempotency/order-id collision modeling

---

## Executive Summary

The system exhibits robust patterns: idempotency keys (SHA-256), FOR UPDATE SKIP LOCKED for claim RPCs, circuit breakers for Google Ads, and zero-loss fallback when QStash fails. However, **extinction-level fractures** exist across the four Abyssal Pillars: phantom billable from idempotency-before-persist, seal-enqueue split-brain, poison-pill batch head-of-line blocking, order-id collision causing silent Google Ads dedupe, and pool exhaustion under burst concurrency.

---

## 1. Split-Brain & Phantom Data (Distributed Transactions)

### Fracture 1.1 — Phantom Billable: Idempotency Insert Before Session/Event Persist

- **[Extinction Threat]:** ☣️ FATAL PARADOX
- **[The Paradox]:** The ingest worker inserts idempotency in `runSyncGates` and increments `site_usage_monthly` via `increment_usage_checked` **before** `processSyncEvent` runs. If `processSyncEvent` throws (e.g. DB timeout, constraint violation, out-of-memory) after idempotency and usage are committed, the system state diverges: Postgres has an idempotency row and an incremented usage counter, but **no** session or event row. On QStash retry, the worker hits a duplicate idempotency key, returns early, and never persists the event. Result: **phantom billable** — we invoiced for an event that never materialized in sessions/events. Revenue is overstated; analytics and attribution are corrupted.
- **[Location]:** `lib/ingest/sync-gates.ts` lines 41–96 (idempotency insert, increment_usage_checked) and `app/api/workers/ingest/route.ts` lines 108–122 (gates before processSyncEvent).

```ts
// sync-gates.ts: idempotency inserted, usage incremented, BEFORE caller persists session/event
const idempotencyResult = await tryInsertIdempotencyKey(...);
// ...
const { data: incResult } = await adminClient.rpc('increment_usage_checked', ...);
// Caller then runs processSyncEvent — if it throws, we have idempotency + usage but no session/event
```

- **[The Abyssal Refactor]:** **Outbox Pattern** or **Two-Phase Commit semantics**. Option A: Defer idempotency insert until **after** session/event persist in a single DB transaction (violates current “gates before persist” design). Option B: Use an **Outbox** — insert `(idempotency_key, payload)` into a staging table in the same transaction as session/event; a separate process marks idempotency and increments usage only after staging row is confirmed persisted. Option C: **Compensation** — on processSyncEvent failure, call `updateIdempotencyBillableFalse` or a new `revert_idempotency_usage` RPC to roll back usage and mark idempotency as non-billable/voided. This requires the worker to detect the failure path and explicitly compensate.

---

### Fracture 1.2 — Seal/Enqueue Split-Brain: Call Sealed, OCI Never Enqueued

- **[Extinction Threat]:** ☣️ FATAL PARADOX
- **[The Paradox]:** The seal route updates the call (lead_score, sale_amount, confirmed_at) in the DB and **then** calls `enqueueSealConversion`. If `enqueueSealConversion` throws (network, DB error, consent check failure), the route catches the error, logs it, and returns `200 OK` with the sealed call. Result: **split-brain** — our DB records a sealed call with revenue, but no row is inserted into `offline_conversion_queue`. Google Ads never receives the conversion; ROAS is understated; the revenue kernel and marketing attribution diverge.
- **[Location]:** `app/api/calls/[id]/seal/route.ts` lines 160–182.

```ts
try {
  const result = await enqueueSealConversion({ callId, siteId, confirmedAt, ... });
  // ...
} catch (enqueueErr) {
  logError('seal_oci_enqueue_failed', ...);
  // Non-fatal: seal succeeded; OCI enqueue is best-effort — RETURNS 200
}
```

- **[The Abyssal Refactor]:** **Atomic Enqueue with Seal** — move OCI enqueue into the same DB transaction as the call update. Use an RPC `seal_call_and_enqueue_oci(p_call_id uuid)` that (1) FOR UPDATE locks the call, (2) updates status/lead_score/sale_amount, (3) inserts into `offline_conversion_queue` if conditions met, (4) commits. If the insert fails (e.g. unique violation), the whole transaction rolls back and the API returns 409/500. Alternative: **Transactional Outbox** — write an `oci_enqueue_outbox` row in the same transaction as the call update; a background worker drains the outbox and enqueues to OCI. The call is only considered “seal complete” when the outbox row exists.

---

### Fracture 1.3 — QStash vs Fallback: No Idempotency at Sync; Fallback Row ≠ Billable

- **[Extinction Threat]:** ☢️ ANOMALY
- **[The Paradox]:** When QStash publish fails, the sync route writes to `ingest_fallback_buffer` and returns `200` with `x-opsmantik-degraded: qstash_publish_failed`. The recover cron later republishes to QStash. There is **no** idempotency insert at sync time — idempotency happens in the worker. So: fallback row = “event captured for later processing”; no phantom billable from this path. However, if the recover cron **deletes** or marks RECOVERED before QStash actually accepts the message, and QStash later fails to deliver, we could lose the event. The `get_and_claim_fallback_batch` RPC sets status to PROCESSING before publish; on publish failure we set back to PENDING. So no silent loss. The anomaly is **informational**: fallback buffer and QStash are eventually consistent; under prolonged QStash outage, fallback rows accumulate and must be monitored.
- **[Location]:** `app/api/sync/route.ts` lines 292–296; `app/api/cron/recover/route.ts`; `supabase/migrations/20260309000000_fix_oci_recovery_routing.sql`.
- **[The Abyssal Refactor]:** No structural change required. Add operational alerts for `ingest_fallback_buffer` PENDING count above threshold; consider a secondary drain (e.g. DLQ) if QStash is permanently unavailable.

---

## 2. The Poison Pill & Queue Asphyxiation

### Fracture 2.1 — Ingest Worker: Payload Getters and Meta Exploits

- **[Extinction Threat]:** ☢️ ANOMALY
- **[The Paradox]:** `parseValidWorkerJobData` normalizes top-level fields (s, url/u, ip, ua) but passes `meta` through via `asMeta(v)` as `Record<string, unknown>`. The worker then spreads `...rest` into the job. If an attacker crafts a payload with `meta` containing a getter (e.g. via `Object.defineProperty`) or a `__proto__`/`constructor` that throws when accessed, the parser may pass (getters are not invoked during `asMeta`), but `processSyncEvent` or downstream code that reads `job.meta.fp`, `job.ev`, etc. will throw. QStash retries; if the error is non-retryable (e.g. TypeError), the message goes to DLQ. Each message is processed independently — **no head-of-line blocking** for other QStash messages. The risk is **single-message crash loop** until DLQ, and potential memory/CPU spike from malformed JSON (e.g. deeply nested structures causing stack overflow during parse).
- **[Location]:** `lib/types/ingest.ts` lines 144–147, 242–263; `lib/ingest/process-sync-event.ts` lines 66–89.
- **[The Abyssal Refactor]:** (1) **Defensive copy** — clone `meta` with a safe function that strips `__proto__`, `constructor`, and non-plain keys before use. (2) **Schema hardening** — validate `meta` with a strict Zod schema and reject unknown shapes. (3) **Parse limits** — enforce max JSON depth and size in `req.json()` middleware to prevent DoS via huge payloads.

---

### Fracture 2.2 — Offline Conversion Queue: Poison Pill Causes Batch Head-of-Line Blocking

- **[Extinction Threat]:** ☣️ FATAL PARADOX
- **[The Paradox]:** The OCI runner claims a **batch** of rows via `claim_offline_conversion_jobs_v2`, maps them with `queueRowToConversionJob`, and calls `adapter.uploadConversions(jobs)`. If `queueRowToConversionJob` throws for **one** row (e.g. `row.payload` has a structure that causes `new Date(row.conversion_time)` to throw, or `row.payload` contains a getter that throws), the entire batch throws **before** upload. The runner then bulk-updates all rows in the batch to RETRY. After `MAX_RETRY_ATTEMPTS` (7), all rows in the batch are marked FAILED — including **healthy** rows that would have succeeded. One poison pill row **blocks and kills** the entire batch.
- **[Location]:** `lib/oci/runner.ts` lines 415–467 (worker mode) and 619–659 (cron mode); `lib/cron/process-offline-conversions.ts` lines 42–71 (`queueRowToConversionJob`).

```ts
const jobs = rowsWithValue.map((r) => queueRowToConversionJob(r)); // throws on first bad row
results = await adapter.uploadConversions({ jobs, credentials });
```

- **[The Abyssal Refactor]:** **Per-Row Try/Catch** — iterate rows, call `queueRowToConversionJob` inside try/catch; on throw, mark that row FAILED (or quarantine) and continue with the rest. Alternatively, **validate-and-filter** — run a validation step that returns `{ valid: ConversionJob[]; invalid: { rowId; error }[] }`; mark invalid rows FAILED, upload only valid jobs. This isolates poison pills and prevents batch-wide failure.

---

### Fracture 2.3 — Payload Deserialization: Regex and Prototype Pollution

- **[Extinction Threat]:** ☢️ ANOMALY
- **[The Paradox]:** Current validation does not use complex regex on user-controlled strings that could cause catastrophic backtracking. `normalizeUrl`, `normalizeReferrer`, etc. use `truncate` and simple checks. The main risk is **payload size** (unbounded `req.json()`) and **deeply nested JSON** causing parse stack overflow. Prototype pollution via `__proto__` or `constructor.prototype` could theoretically affect downstream code if objects are merged without sanitization. The ingest parser spreads `...rest` — if `rest` contains `__proto__`, it would be spread into the normalized object. Most downstream code does not recursively merge; risk is **low** but present.
- **[Location]:** `lib/types/ingest.ts` (parseValidIngestPayload, parseValidWorkerJobData).
- **[The Abyssal Refactor]:** Use a JSON parser with depth/size limits (e.g. `JSON.parse` with a custom reviver that throws on depth > 32). Explicitly exclude `__proto__`, `constructor`, `prototype` when building normalized objects. Add integration tests with malicious payloads (getters, huge strings, deep nesting).

---

## 3. Circular Deadlocks & Pool Exhaustion

### Fracture 3.1 — Claim RPCs: No Circular Wait (Verified)

- **[Extinction Threat]:** N/A — No circular deadlock found.
- **[The Paradox]:** `claim_offline_conversion_jobs_v2`, `claim_billing_reconciliation_jobs`, and `get_and_claim_fallback_batch` all use `FOR UPDATE SKIP LOCKED`. Workers claim by `(site_id, provider_key)` or by buffer status. Different workers lock different row sets; SKIP LOCKED avoids waiting. `confirm_sale_and_enqueue` locks `sales` with FOR UPDATE, then inserts into `offline_conversion_queue`; no reverse dependency (no transaction locks queue and waits for sales).
- **[Location]:** Supabase RPCs; `lib/oci/runner.ts`; `app/api/sales/confirm/route.ts`.
- **[The Abyssal Refactor]:** None. Maintain consistent lock ordering: always lock parent entities (sales, calls) before child (queue) in any future RPCs.

---

### Fracture 3.2 — Connection Pool Exhaustion Under Burst Concurrency

- **[Extinction Threat]:** ☣️ FATAL PARADOX
- **[The Paradox]:** Each serverless invocation (Vercel/Edge) acquires a Supabase connection for `adminClient` calls. Under QStash fan-out (e.g. 500 messages/sec) or overlapping cron runs (recover, process-offline-conversions, enqueue-from-sales), hundreds of concurrent connections can be opened. Supabase/PgBouncer pool limits (default ~100–200) can be exhausted. New requests block or fail with connection timeout. Result: **platform-wide outage** — sync returns 500, workers fail, crons stall.
- **[Location]:** All `adminClient` and `createTenantClient` usage; `app/api/workers/ingest/route.ts`; `lib/oci/runner.ts`; `app/api/cron/recover/route.ts`.
- **[The Abyssal Refactor]:** (1) **Connection pooling** — use Supabase serverless client with connection reuse; enable PgBouncer transaction mode. (2) **Concurrency limits** — cap QStash concurrency per queue; use semaphore (Redis) to limit concurrent worker invocations per site/provider. (3) **Cron staggering** — ensure crons do not overlap; use distributed locks (e.g. Redis) for cron exclusivity. (4) **Circuit breaker** — if connection errors spike, fail fast and return 503 to prevent cascade.

---

## 4. Temporal Exploitation & Hash Collisions

### Fracture 4.1 — Order ID Collision: Same ClickId + Second-Precision Timestamp

- **[Extinction Threat]:** ☣️ FATAL PARADOX
- **[The Paradox]:** Order IDs are built as `${clickId}_V5_SEAL_${sanitizedOccurredAt}` (max 128 chars). `sanitizedOccurredAt` uses `conversion_time` with second-level precision (e.g. `2026-02-25T14:30:00.000Z` → `2026-02-25T14-30-00-000Z`). Two **distinct** conversions — different calls, different values — with the same gclid and conversion time truncated to the second will produce the **same orderId**. Google Ads deduplicates by orderId; the second upload is **silently ignored**. Result: **silent data corruption** — we believe we sent two conversions, but Google only recorded one. Revenue and ROAS are understated; attribution is wrong.
- **[Location]:** `lib/cron/process-offline-conversions.ts` lines 35–40 (`buildOrderId`); `app/api/oci/google-ads-export/route.ts` lines 387–391; `lib/providers/google_ads/mapper.ts`.

```ts
const raw = clickId ? `${clickId}_V5_SEAL_${sanitized}` : fallbackId;
return raw.slice(0, 128);
```

- **[The Abyssal Refactor]:** **Deterministic Unique Suffix** — append a collision-resistant component: e.g. `queue_row_id` or `SHA-256(clickId + conversionTime + callId + valueCents).slice(0,8)`. Format: `${clickId}_V5_SEAL_${conversionTime}_${uniqueSuffix}`. This preserves idempotency for true retries (same row → same orderId) while distinguishing different conversions. Ensure uniqueSuffix is derived from row identity, not random, so retries remain idempotent.

---

### Fracture 4.2 — Idempotency Key: SHA-256 Collision (Negligible)

- **[Extinction Threat]:** N/A — Cryptographically negligible.
- **[The Paradox]:** Idempotency keys use SHA-256 over `site_id:event_name:url:fingerprint:time_bucket`. Birthday paradox: ~2^128 inputs needed for probable collision. Given our event volume, collision is astronomically unlikely.
- **[Location]:** `lib/idempotency.ts` (`computeIdempotencyKey`, `computeIdempotencyKeyV2`).
- **[The Abyssal Refactor]:** None. Maintain SHA-256; consider SHA-384/SHA-512 only if regulatory compliance demands.

---

### Fracture 4.3 — 5-Gear Time Decay: Epoch and Far-Future Timestamps

- **[Extinction Threat]:** ☢️ ANOMALY
- **[The Paradox]:** `calculateSignalEV` uses `elapsedMs = max(0, signalDate - clickDate)` and `days = ceil(elapsedMs / MS_PER_DAY)`. If `clickDate` is epoch (1970) or `signalDate` is far future (2099), `days` becomes huge; `getDecayProfileForGear` returns the tail multiplier (0.05–0.15). No NaN — `base * multiplier` remains finite. `extractPayloadTsMs` clamps to server time for click/call_intent; for heartbeat/page_view, payload ts is used only if within 5 min of server. So malicious epoch/future injection is largely neutralized. Remaining risk: if `valueCents` or `aov` is `Infinity` or `NaN`, `getBaseValueForGear` uses `safeAov` (clamped); `Number.isFinite` guards are present. **Low** residual risk of NaN propagation if a future code path bypasses guards.
- **[Location]:** `lib/domain/mizan-mantik/time-decay.ts`; `lib/idempotency.ts` (`extractPayloadTsMs`, `getV2TimeComponentSafe`).
- **[The Abyssal Refactor]:** Add explicit `Number.isFinite` checks at the boundary of `calculateSignalEV` and `getBaseValueForGear`; log and clamp any non-finite inputs. Reject payloads with timestamps outside a sane window (e.g. ±10 years from now) at parse time.

---

## Summary Matrix

| Fracture                          | Threat   | Pillar              | Refactor                                      |
|----------------------------------|----------|---------------------|-----------------------------------------------|
| Phantom Billable (idempotency)   | ☣️ FATAL | Split-Brain         | Outbox / Compensation                         |
| Seal/Enqueue Split-Brain         | ☣️ FATAL | Split-Brain         | Atomic RPC or Transactional Outbox            |
| QStash/Fallback                  | ☢️ ANOMALY | Split-Brain       | Operational alerts                            |
| Ingest Meta Getters              | ☢️ ANOMALY | Poison Pill        | Defensive copy, Zod schema                    |
| OCI Batch Poison Pill            | ☣️ FATAL | Poison Pill         | Per-row try/catch, validate-and-filter        |
| Payload Size/Depth               | ☢️ ANOMALY | Poison Pill        | Parse limits, sanitize __proto__              |
| Circular Deadlock                | N/A      | Deadlock            | None (verified safe)                          |
| Pool Exhaustion                  | ☣️ FATAL | Pool                | Pool config, concurrency limits, cron stagger |
| Order ID Collision               | ☣️ FATAL | Temporal            | Unique suffix in orderId                      |
| Idempotency SHA-256              | N/A      | Temporal            | None                                          |
| 5-Gear Epoch/Future              | ☢️ ANOMALY | Temporal          | Boundary checks, timestamp window             |

---

**End of Extinction Dossier**
