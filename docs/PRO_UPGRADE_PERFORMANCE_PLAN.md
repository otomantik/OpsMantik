# Pro Upgrade Performance Plan (Iron Seal @ $299 Quality)

**Goals:** Dashboard <200ms, Seal event <50ms. 10,000+ clients. Append-only integrity preserved.

---

## 1. Connection Pooling (Transaction Mode / PGBouncer)

**Current:** Supabase JS client uses REST API (`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`). No raw Postgres connection.

**Action:**
- Supabase Pro exposes a **Connection Pooler** (Transaction mode, port 6543). Use it for any direct Postgres usage (e.g. Prisma, Drizzle, raw `pg`).
- If staying Supabase JS only: REST API is already pooled server-side. Add env placeholder for future:
  - `SUPABASE_POOLER_URL` — for Prisma/Drizzle when added
- Document in `.env.example`:
  ```
  # Supabase Pro: Transaction Mode (PGBouncer) for direct Postgres
  # SUPABASE_POOLER_URL=postgresql://...@db.xxx.supabase.co:6543/postgres
  ```

**File:** [lib/supabase/admin.ts](lib/supabase/admin.ts) — already notes Transaction Pooler for direct Postgres.

---

## 2. Index Strategy (Pro Level)

### 2.1 Iron Seal Tables (revenue_snapshots, provider_dispatches)

**Add to Iron Seal migration** (`supabase/migrations/YYYYMMDD_sprint_iron_seal.sql`):

```sql
-- GIN indexes for fraud-pattern filtering on JSONB
CREATE INDEX idx_rev_snapshots_reasons_gin
  ON public.revenue_snapshots USING GIN (reasons_json);

CREATE INDEX idx_rev_snapshots_meta_gin
  ON public.revenue_snapshots USING GIN (meta_json);

-- Partial index: worker claims PENDING only
CREATE INDEX idx_provider_dispatch_pending
  ON public.provider_dispatches (snapshot_id, provider_key, next_retry_at)
  WHERE status = 'PENDING';
```

### 2.2 Existing Tables

- `offline_conversion_queue`: `idx_offline_conversion_queue_eligible_scan` (partial on QUEUED/RETRY) — exists.
- `ingest_idempotency`: `idx_ingest_idempotency_created_at` — exists. Add composite if heavy by `(site_id, created_at)`.

---

## 3. Batch-Insert / Bulk UPSERT

### 3.1 Seal Path

**Current:** [lib/oci/enqueue-seal-conversion.ts](lib/oci/enqueue-seal-conversion.ts) — single-row insert per seal.

**Iron Seal:** `sealSessionOrCall` will insert:
- 1 row into `revenue_snapshots` (ON CONFLICT DO NOTHING)
- N rows into `provider_dispatches` (one per provider)

**Refactor:**
```ts
// provider_dispatches: bulk insert
await adminClient.from('provider_dispatches').insert(
  providers.map(p => ({ snapshot_id: snapshot.id, provider_key: p, status: 'PENDING' }))
);
```
Already a single INSERT with multiple rows. No change needed if providers.length is small.

### 3.2 Ingest Path

**Current:** [lib/ingest/process-sync-event.ts](lib/ingest/process-sync-event.ts) — one event per QStash job; single insert into `processed_signals`.

**Refactor (optional):**
- Ingest worker: accept `{ events: [...] }`, batch-insert `processed_signals` with ON CONFLICT DO NOTHING. Requires worker contract change.
- `ingest_idempotency`: use `upsert` with `onConflict: 'site_id,idempotency_key'` for idempotent inserts.

**File:** [lib/idempotency.ts](lib/idempotency.ts) — change from `insert` to `upsert` with `ignoreDuplicates: true`.

### 3.3 PostgreSQL RPC for Bulk Seal

Create RPC for seal path to reduce round-trips:

```sql
CREATE OR REPLACE FUNCTION public.seal_session_or_call_bulk(p_rows jsonb)
RETURNS jsonb ...
-- Insert revenue_snapshots (ON CONFLICT DO NOTHING RETURNING id)
-- Insert provider_dispatches in one batch
```

Single DB round-trip for seal + enqueue.

---

## 4. Edge Function Warm-up

### 4.1 Vercel Cron Keep-Alive

Add cron route to ping critical endpoints:

| Route | Schedule | Purpose |
|-------|----------|---------|
| `/api/health` | `*/5 * * * *` | Keep seal/ingest warm |

**File:** `app/api/health/route.ts` — lightweight 200 response.

**vercel.json:**
```json
{"path":"/api/health","schedule":"*/5 * * * *"}
```

### 4.2 Site Config Caching

**Current:** Seal and OCI paths fetch site config per request.

**Refactor:**
- Add in-memory cache (TTL 60s) for `sites.oci_config`, `sites.currency` by site_id.
- Use `unstable_cache` or a simple `Map` with TTL.
- Pre-fetch on first request; subsequent requests hit cache.

**File:** New `lib/cache/site-config-cache.ts`:
```ts
const cache = new Map<string, { data: SiteConfig; expires: number }>();
const TTL_MS = 60_000;
```

---

## 5. Read/Write Splitting

### 5.1 Structure

| Path | Client | Use Case |
|------|--------|----------|
| Seal, Ingest, OCI enqueue | `adminClient` (write) | Critical path |
| Dashboard, Stats, Command Center | `readClient` (future read replica) | Heavy analytics |

**Current:** Both use same Supabase URL.

**Action:**
1. Introduce `readClient` in [lib/supabase/admin.ts](lib/supabase/admin.ts):
   - If `SUPABASE_READ_REPLICA_URL` is set, use it for read-only RPCs.
   - Else, use same URL as `adminClient`.
2. Dashboard route: use `readClient.rpc('get_dashboard_stats', ...)`.
3. Seal route: keep `adminClient` for writes.

**Supabase Pro:** Read replicas available. Configure read replica URL in Supabase dashboard, set `SUPABASE_READ_REPLICA_URL` in Vercel.

### 5.2 Response Caching

- Dashboard stats: `Cache-Control: private, max-age=30` — 30s client cache.
- Seal response: no cache (real-time).

---

## 6. Latency Targets

| Endpoint | Target | Current |
|----------|--------|---------|
| POST /api/calls/[id]/seal | <50ms | Measure |
| GET /api/reporting/dashboard-stats | <200ms | 10s timeout |
| get_dashboard_stats RPC | <150ms | — |

**Seal path optimization:**
1. Reduce round-trips: batch call + enqueue in single RPC.
2. Pre-fetch site config (cache).
3. Validate access in parallel with config fetch where possible.

**Dashboard path optimization:**
1. Use read replica.
2. Add `Cache-Control` header.
3. Reduce RPC complexity (materialized view if needed).

---

## 7. Implementation Order

1. **Iron Seal migration** — Add GIN + partial indexes.
2. **Site config cache** — 60s TTL for oci_config, currency.
3. **Health cron** — Keep seal/ingest warm.
4. **readClient** — Introduce; wire dashboard stats to it when replica URL is set.
5. **Batch provider_dispatches** — Already single insert; verify.
6. **ingest_idempotency upsert** — Switch from insert to upsert.
7. **seal RPC** — Optional: single-round-trip seal + enqueue.

---

## 8. Constraints Checklist

- [ ] Append-only: revenue_snapshots UPDATE/DELETE blocked by trigger
- [ ] Seal <50ms: measured and documented
- [ ] Dashboard <200ms: measured and documented
- [ ] No behavior change outside performance
