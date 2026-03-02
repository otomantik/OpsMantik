# DOOMSDAY DOSSIER — Apex Omni-Architect Audit

**Date:** 2026-02-25  
**Scope:** Full codebase across 4 Apex Pillars  
**Methodology:** Extreme scale simulation (100x load), catastrophic failure injection, hostile actor modeling

---

## Executive Summary

The architecture has strong foundations: RLS policies, circuit breakers for Google Ads, cron locks, idempotency, and tenant isolation via `site_id` in most paths. However, **critical fractures** exist in data gravity, N+1 query patterns, OCI API auth, and unbounded reads that will cause systemic collapse under scale or targeted attack.

---

## 1. Data Gravity & N+1 Black Holes

### Fracture 1.1 — Unbounded `offline_conversion_queue` Select (sweep-unsent-conversions)

- **[Threat Level]:** 💥 CATASTROPHIC
- **[The Fracture]:** `sweep-unsent-conversions` fetches **all** `call_id` values from `offline_conversion_queue` with no `LIMIT`. At 1M queue rows, this loads 1M UUIDs into memory, exhausts the serverless function memory, and crashes the cron. Subsequent cron runs fail; orphans accumulate; OCI pipeline stalls.
- **[Location]:** `app/api/cron/sweep-unsent-conversions/route.ts` lines 31–32

```ts
adminClient.from('offline_conversion_queue').select('call_id').not('call_id', 'is', null),
```

- **[The Omni-Refactor]:** Use a bounded query or streaming:

```ts
// Option A: Sample only recent call_ids
const { data: queueRows } = await adminClient
  .from('offline_conversion_queue')
  .select('call_id')
  .not('call_id', 'is', null)
  .gte('created_at', sinceIso)
  .limit(MAX_ORPHANS_PER_RUN * 10); // Bounded scan

// Option B: Use raw SQL with cursor/stream if Supabase supports it
// Option C: RPC that returns only distinct call_ids for lookback window
```

---

### Fracture 1.2 — Unbounded Queue and `marketing_signals` Selects (google-ads-export)

- **[Threat Level]:** ⚠️ SEVERE
- **[The Fracture]:** `google-ads-export` fetches **all** `QUEUED`/`RETRY` rows from `offline_conversion_queue` and **all** `PENDING` rows from `marketing_signals` without `.limit()`. A site with 100k queued conversions returns a massive JSON payload, times out, and crashes the Google Ads Script.
- **[Location]:** `app/api/oci/google-ads-export/route.ts` lines 132–156

```ts
const query = adminClient
  .from('offline_conversion_queue')
  .select(...)
  .eq('site_id', siteUuid)
  .in('status', ['QUEUED', 'RETRY'])
  .order('created_at', { ascending: true });
// NO .limit()

const { data: signalRows } = await adminClient
  .from('marketing_signals')
  .select(...)
  .eq('site_id', siteUuid)
  .eq('dispatch_status', 'PENDING')
  .order('created_at', { ascending: true });
// NO .limit()
```

- **[The Omni-Refactor]:** Cap export size and paginate:

```ts
const EXPORT_LIMIT = 1000;
const query = adminClient
  .from('offline_conversion_queue')
  .select(...)
  .eq('site_id', siteUuid)
  .in('status', ['QUEUED', 'RETRY'])
  .order('created_at', { ascending: true })
  .limit(EXPORT_LIMIT);

// Same for marketing_signals; add cursor support for next page
```

---

### Fracture 1.3 — N+1 `getPrimarySource` in google-ads-export

- **[Threat Level]:** ⚠️ SEVERE
- **[The Fracture]:** For each `signal` in `signalList`, the route calls `await getPrimarySource(siteUuid, { callId })`. With 500 signals, that's 500 sequential DB round-trips. Latency scales linearly; Google Ads Script timeouts increase; export fails.
- **[Location]:** `app/api/oci/google-ads-export/route.ts` lines 162–189

```ts
for (const sig of signalList) {
  const source = await getPrimarySource(siteUuid, { callId });  // N+1
  // ...
}
```

- **[The Omni-Refactor]:** Batch fetch primary sources:

```ts
const callIds = signalList.map((s) => (s as { call_id?: string }).call_id).filter(Boolean);
const sourceMap = await getPrimarySourceBatch(siteUuid, callIds); // New batch RPC
for (const sig of signalList) {
  const source = sourceMap.get(sig.call_id) ?? null;
  // ...
}
```

Add RPC `get_primary_source_batch(p_site_id, p_call_ids uuid[])` that returns `call_id -> primary_source` in a single round-trip.

---

### Fracture 1.4 — N+1 Redis `get` in google-ads-export (PV Pipeline)

- **[Threat Level]:** ⚠️ SEVERE
- **[The Fracture]:** After `lmove`-ing up to 500 PV IDs, the route loops `for (const pvId of pvIds)` and calls `await redis.get(\`pv:data:${pvId}\`)` per ID. Up to 500 sequential Redis round-trips; latency balloons.
- **[Location]:** `app/api/oci/google-ads-export/route.ts` lines 206–236

- **[The Omni-Refactor]:** Use `redis.mget` or pipeline:

```ts
const keys = pvIds.map((id) => `pv:data:${id}`);
const values = await redis.mget(...keys);  // Or pipeline
for (let i = 0; i < pvIds.length; i++) {
  const raw = values[i];
  if (!raw || typeof raw !== 'string') continue;
  // ...
}
```

---

### Fracture 1.5 — N+1 Queue Updates in `syncQueueValuesFromCalls`

- **[Threat Level]:** ⚠️ SEVERE
- **[The Fracture]:** `lib/oci/runner.ts` line 163: for each `{ id, value_cents }` in `toUpdate`, a separate `adminClient.from('offline_conversion_queue').update(...).eq('id', id)` is issued. With 200 rows, that's 200 round-trips. `bulkUpdateQueue` exists but is not used here.
- **[Location]:** `lib/oci/runner.ts` lines 161–167

```ts
for (const { id, value_cents } of toUpdate) {
  const { error } = await adminClient.from('offline_conversion_queue').update(...).eq('id', id);
  // ...
}
```

- **[The Omni-Refactor]:** Use existing `bulkUpdateQueue` or group by identical payloads:

```ts
// Group by value_cents for bulk update
const byValue = new Map<number, string[]>();
for (const { id, value_cents } of toUpdate) {
  const ids = byValue.get(value_cents) ?? [];
  ids.push(id);
  byValue.set(value_cents, ids);
}
for (const [value_cents, ids] of byValue) {
  await bulkUpdateQueue(ids, { value_cents, updated_at: new Date().toISOString() }, prefix, 'Sync queue value_cents');
}
```

---

### Fracture 1.6 — Unbounded Sites Select (Operational Script)

- **[Threat Level]:** ⚠️ SEVERE (ops context)
- **[The Fracture]:** `scripts/generate-missing-keys.ts` runs `admin.from('sites').select('id, public_id, oci_api_key, name')` with no `LIMIT`. At 100k sites, memory pressure and slow execution.
- **[Location]:** `scripts/generate-missing-keys.ts` line 27

- **[The Omni-Refactor]:** Paginate with `range` or cursor:

```ts
const PAGE_SIZE = 500;
let offset = 0;
let hasMore = true;
while (hasMore) {
  const { data, error } = await admin.from('sites').select('id, public_id, oci_api_key, name').range(offset, offset + PAGE_SIZE - 1);
  // process batch
  offset += PAGE_SIZE;
  hasMore = (data?.length ?? 0) === PAGE_SIZE;
}
```

---

## 2. Cascading Failures & Circuit Breakers

### Fracture 2.1 — Google Ads API: 30s Timeout, No Upper Retry Cap

- **[Threat Level]:** ⚠️ SEVERE
- **[The Fracture]:** `lib/providers/google_ads/adapter.ts` uses `REQUEST_TIMEOUT_MS = 30_000`. On timeout, the queue row is marked `RETRY`. If the API is down for 2 hours, every worker invocation times out; rows retry indefinitely with exponential backoff. QStash continues to invoke the worker; memory and CPU spike; noisy-neighbor tenants block others.
- **[Location]:** `lib/providers/google_ads/adapter.ts` lines 25–26, queue retry logic in `lib/oci/constants.ts` (MAX_RETRY_ATTEMPTS = 7)

- **[The Omni-Refactor]:** Circuit breaker already exists (`provider_health_state`). Ensure:
  1. Timeouts are classified as transient and increment the circuit failure count.
  2. Circuit opens after 5 transient failures → no further Google Ads calls until probe.
  3. Add explicit cap on total retries (already MAX_RETRY_ATTEMPTS = 7 → FAILED) and alert on high FAILED counts.

Verify `classifyGoogleAdsError` treats fetch timeout as `ProviderTransientError` so it feeds the circuit.

---

### Fracture 2.2 — QStash Backlog Unbounded; No Backpressure

- **[Threat Level]:** ⚠️ SEVERE
- **[The Fracture]:** Sync accepts events and publishes each to QStash. If the worker is slow (DB down, Redis degraded), QStash queue depth grows without limit. A single tenant sending 50k events/min saturates the queue; all tenants share the same processing bottleneck. No `tenant_concurrency_limit` or pre-publish depth check.
- **[Location]:** `app/api/sync/route.ts`, `lib/ingest/publish.ts`; documented in `docs/saas-engine-audit.md`

- **[The Omni-Refactor]:** Add backpressure:

```ts
// Before publish: check site's active job count (Redis or DB)
const activeJobs = await getSiteActiveJobCount(siteId);
if (activeJobs >= SITE_CONCURRENCY_LIMIT) {
  return NextResponse.json(
    { ok: false, error: 'queue_saturated', retryAfter: 60 },
    { status: 429, headers: { 'Retry-After': '60' } }
  );
}
```

Add `tenant_concurrency_limit` in `sites` and enforce before QStash publish.

---

### Fracture 2.3 — Redis Outage: Semaphore Fail-Open Path

- **[Threat Level]:** ⚠️ SEVERE
- **[The Fracture]:** When Redis is down, `acquireSemaphore` returns `null` → CONCURRENCY_LIMIT path; queue rows get `RETRY`. Throughput drops to zero, but no cascading crash. Docs indicate "fail-open" for rate limit; semaphore is fail-closed (no token = no upload). Ensure Redis outage is monitored and does not silently degrade for extended periods.
- **[Location]:** `lib/providers/limits/semaphore.ts`, `lib/oci/runner.ts`

- **[The Omni-Refactor]:** Add alerting on `REDIS_OUTAGE_SEMAPHORE_ACQUIRE` and circuit-breaker-style "Redis degraded" state to avoid hammering Redis during outage.

---

## 3. Domain Bleeding & Architectural Coupling

### Fracture 3.1 — OCI Runner God Object

- **[Threat Level]:** ⚠️ SEVERE
- **[The Fracture]:** `lib/oci/runner.ts` owns: claim, health gate, credential fetch, upload, circuit outcome persistence, semaphore, bulk updates, value sync, and ledger writes. Any change risks regressions; testing is high-cost; new providers require touching this monolith.
- **[Location]:** `lib/oci/runner.ts` (~900+ lines); `docs/tech-debt-audit-report.md`

- **[The Omni-Refactor]:** Extract modules:

```ts
// lib/oci/claim.ts — list groups, claim jobs
// lib/oci/health-gate.ts — circuit check, record_provider_outcome
// lib/oci/upload-batch.ts — adapter call, map results
// lib/oci/sync-queue-values.ts — sync value_cents from calls
// lib/oci/runner.ts — orchestrator only
```

---

### Fracture 3.2 — google-ads-export: Tri-Pipeline Monolith

- **[Threat Level]:** ⚠️ SEVERE
- **[The Fracture]:** One route handles: queue export, marketing_signals export, Redis PV export, ACK routing, and call/session resolution. Hard to test, hard to evolve; N+1 and unbounded reads are compounded.
- **[Location]:** `app/api/oci/google-ads-export/route.ts`

- **[The Omni-Refactor]:** Split into:

```ts
// lib/oci/export/queue-export.ts — queue + signals (with limits)
// lib/oci/export/pv-export.ts — Redis PV batch
// lib/oci/export/merge-and-format.ts — merge, dedup, format
// app/api/oci/google-ads-export/route.ts — auth + orchestrate
```

---

## 4. Silent Privilege Escalation & Tenancy Leaks (Security)

### Fracture 4.1 — IDOR: OCI API Key Allows Any Site Access

- **[Threat Level]:** 💥 CATASTROPHIC
- **[The Fracture]:** When auth is via `x-api-key` (shared `OCI_API_KEY`), `siteIdFromAuth` is empty. The route uses `siteId = siteIdFromAuth || siteIdParam` (export) or `siteIdBody` (ack). An attacker with the API key can pass `siteId=VictimSiteUUID` and read/ack **any** site's conversions. Full IDOR across tenants.
- **[Location]:** `app/api/oci/google-ads-export/route.ts` lines 69–85; `app/api/oci/ack/route.ts` lines 56–58; `app/api/oci/ack-failed/route.ts` lines 51–53

```ts
if (!authed && envKey && timingSafeCompare(apiKey, envKey)) {
  authed = true;
  // siteIdFromAuth stays ''
}
const siteId = siteIdFromAuth || siteIdParam;  // siteIdParam is user-controlled!
```

- **[The Omni-Refactor]:** When using API key auth, **never** trust client-provided `siteId`:

```ts
if (!authed && envKey && timingSafeCompare(apiKey, envKey)) {
  authed = true;
  // API key does NOT bind to a site; require session token for multi-tenant export
  // OR: map api_key -> allowed_site_ids in DB (per-site API keys)
}

// If apiKey auth: reject requests without a site-scoped token
if (authed && !siteIdFromAuth && siteIdParam) {
  return NextResponse.json(
    { error: 'API key auth requires session token for site-scoped export' },
    { status: 403 }
  );
}
```

Alternatively, implement per-site API keys stored in DB and resolve `site_id` from the key, not from the request body/query.

---

### Fracture 4.2 — track/pv: No Site Validation; Data Pollution

- **[Threat Level]:** ⚠️ SEVERE
- **[The Fracture]:** `POST /api/track/pv` accepts `siteId` from the request body with no validation that the site exists or that the caller is authorized. An attacker can send `{ siteId: 'victim_public_id', gclid: 'fake' }` and pollute the victim's Redis PV queue. Victim's export and stats are corrupted; denial of service to legitimate data.
- **[Location]:** `app/api/track/pv/route.ts` lines 31–45

- **[The Omni-Refactor]:** Validate site and optionally scope by origin:

```ts
const site = await SiteService.resolveSite(siteId);
if (!site?.id) {
  return NextResponse.json({ ok: true }, { status: 200, headers: corsHeaders });
}
// Optional: validate Origin/CORS against site's allowed domains
await evaluateAndRouteSignal('V1_PAGEVIEW', { siteId: site.id, ... });
```

---

### Fracture 4.3 — RLS Bypass via service_role: Consistent Pattern

- **[Threat Level]:** Informational (by design)
- **[The Fracture]:** All API routes use `adminClient` (service_role), which bypasses RLS. Tenant isolation depends on **application-level** `site_id` filtering. Missing `.eq('site_id', ...)` in any query → cross-tenant leak. Audit confirms most reads are scoped; `tenant-scope-audit.test.ts` exists to detect unscoped `adminClient.from('calls')` patterns.
- **[Location]:** Various; `tests/unit/tenant-scope-audit.test.ts`

- **[The Omni-Refactor]:** Continue tenant-scope audits; add middleware or wrapper that logs/queries without `site_id` scope for high-risk tables.

---

## Summary: Priority Matrix

| Priority | Fracture                         | Threat       | Effort |
|----------|----------------------------------|--------------|--------|
| P0       | 4.1 OCI API key IDOR             | CATASTROPHIC | Medium |
| P0       | 1.1 sweep offline_conversion_queue unbounded | CATASTROPHIC | Low    |
| P1       | 1.2 google-ads-export unbounded  | SEVERE       | Low    |
| P1       | 1.3 N+1 getPrimarySource         | SEVERE       | Medium |
| P1       | 2.2 QStash backpressure          | SEVERE       | Medium |
| P1       | 1.5 N+1 syncQueueValuesFromCalls | SEVERE       | Low    |
| P2       | 1.4 N+1 redis.get                | SEVERE       | Low    |
| P2       | 4.2 track/pv site validation     | SEVERE       | Low    |
| P2       | 3.1, 3.2 Runner/Export refactor  | SEVERE       | High   |

---

*Generated by Apex Omni-Architect Doomsday Audit. Treat as architectural guidance; implement fixes in priority order with tests.*
