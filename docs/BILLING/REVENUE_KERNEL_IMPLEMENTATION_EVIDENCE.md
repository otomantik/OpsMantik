# Revenue Kernel Implementation Evidence

**Date:** 13 Feb 2026  
**Spec:** Revenue Kernel — Architecture Audit & Freeze (docs/BILLING/REVENUE_KERNEL_ARCHITECTURE_AUDIT.md)

---

## Files Changed

| Path | Change |
|------|--------|
| `lib/idempotency.ts` | 90-day retention; `computeIdempotencyExpiresAt()`; Invoice authority banner. |
| `app/api/sync/route.ts` | Order comment; 429 rate limit header `x-opsmantik-ratelimit: 1`; TODO quota; duplicate comment. |
| `supabase/migrations/20260215000000_ingest_idempotency_retention_90d.sql` | Backfill `expires_at` to created_at + 90d; comment on column. |
| `docs/BILLING/IDEMPOTENCY_CLEANUP_JOB.md` | Cleanup job plan (DELETE WHERE expires_at < NOW()). |
| `tests/unit/idempotency.test.ts` | `computeIdempotencyExpiresAt` test; concurrent same-key test. |
| `tests/unit/revenue-kernel-gates.test.ts` | PR gates: dedup path, rate limit header, order, fallback after idempotency. |
| `docs/BILLING/REVENUE_KERNEL_IMPLEMENTATION_EVIDENCE.md` | This file. |
| `docs/BILLING/REVENUE_KERNEL_MASTER_PLAN.md` | Master freeze; data access rule. |
| `supabase/migrations/20260216000000_revenue_kernel_pr1.sql` | PR-1: billing_state, site_plans, site_usage_monthly, invoice_snapshot, ingest_idempotency extend. |
| `supabase/migrations/20260216000001_revenue_kernel_pr1_p0_p1.sql` | P0: ingest_idempotency RLS (SELECT site members; no tenant UPDATE). P1: year_month NOT NULL, index, site_plans.updated_at trigger. |
| `supabase/migrations/20260216000002_revenue_kernel_pr2_idempotency_version.sql` | PR-2: idempotency_version column (default 1); index (site_id, year_month, idempotency_version) WHERE billable. |
| `lib/idempotency.ts` | PR-2: getIdempotencyVersion, getV2TimeComponent, v2 key prefix "v2:", idempotencyVersionFromKey, insert idempotency_version. |
| `docs/BILLING/REVENUE_KERNEL_MASTER_PLAN.md` | Idempotency v1/v2 table + rollout. |
| `lib/quota.ts` | PR-3: getCurrentYearMonthUTC, getSitePlan, getUsageRedis/PgSnapshot/PgCount, getUsage, evaluateQuota, computeRetryAfterToMonthRollover, incrementUsageRedis. |
| `lib/idempotency.ts` | PR-3: updateIdempotencyBillableFalse, setOverageOnIdempotencyRow. |
| `app/api/sync/route.ts` | PR-3: Quota after idempotency; reject → 429 + billable=false; overage → billing_state=OVERAGE; headers; Redis increment on publish/fallback success. |
| `tests/unit/quota.test.ts` | PR-3: hard limit reject, soft/overage, hard cap reject, headers clamp, retry-after. |
| `tests/unit/revenue-kernel-gates.test.ts` | PR-3: order Idempotency→Quota→Publish; quota reject no publish/fallback; quota-exceeded header; billable=false update. |
| `supabase/migrations/20260216000004_revenue_kernel_pr4_reconciliation_jobs.sql` | PR-4: billing_reconciliation_jobs table, claim_billing_reconciliation_jobs RPC (FOR UPDATE SKIP LOCKED). |
| `lib/reconciliation.ts` | PR-4: reconcileUsageForMonth — COUNT(ingest_idempotency), UPSERT site_usage_monthly, optional Redis correction. |
| `app/api/cron/reconcile-usage/enqueue/route.ts` | PR-4: GET enqueue cron; active sites; UPSERT jobs ON CONFLICT DO NOTHING. |
| `app/api/cron/reconcile-usage/run/route.ts` | PR-4: POST run cron; claim jobs, reconcile, COMPLETED/FAILED; BILLING_RECONCILE_OK/FAILED logs. |
| `lib/services/watchtower.ts` | PR-4: billingReconciliationDriftLast1h check (sites with drift_pct > 1% in last 1h). |
| `tests/unit/reconciliation.test.ts` | PR-4: reconcile shape, Redis best-effort, drift calculation. |
| `tests/unit/revenue-kernel-gates.test.ts` | PR-4: reconciliation authority ingest_idempotency; job runner SKIP LOCKED. |
| `app/api/cron/reconcile-usage/route.ts` | PR-4.1: Unified GET — enqueue then claim+run (50), idempotent; response: ok, enqueued, processed, completed, failed, request_id. |
| `app/api/cron/invoice-freeze/route.ts` | PR-6: POST invoice-freeze; freeze previous month (UTC) from site_usage_monthly; snapshot_hash=sha256(...); ON CONFLICT DO NOTHING. |
| `app/api/billing/dispute-export/route.ts` | PR-7: GET dispute-export?site_id=&year_month=; RBAC billing:view; CSV created_at, idempotency_key, idempotency_version, billing_state, billable; headers x-opsmantik-snapshot-hash, x-opsmantik-export-hash; log BILLING_DISPUTE_EXPORT. |
| `lib/billing-metrics.ts` | PR-8: In-memory counters + BILLING_METRIC log; ingest allowed/duplicate/rejected_quota/rate_limited/overage/degraded; reconciliation runs ok/failed. |
| `app/api/sync/route.ts` | PR-8: Increment billing metrics on each path (rate limit, duplicate, rejected_quota, allowed, overage, degraded). |
| `app/api/cron/reconcile-usage/route.ts`, `run/route.ts` | PR-8: Increment billing_reconciliation_runs_ok_total / billing_reconciliation_runs_failed_total. |
| `app/api/metrics/route.ts` | PR-8: GET /api/metrics (cron or admin); JSON with billing counters + billing_reconciliation_drift_sites_last1h from DB. |
| `app/api/cron/watchtower/route.ts` | PR-8: Response includes billing_metrics (counters + drift_sites_last1h). |
| `tests/unit/billing-metrics.test.ts` | PR-8: Unit tests for counter increments and code-path assertions. |
| `app/api/cron/reconcile-usage/backfill/route.ts` | Backfill: POST backfill; body `{ site_id?, from, to }` (YYYY-MM); validate range ≤12 months; enqueue missing jobs (UPSERT DO NOTHING); return `{ enqueued, months, sites }`. |
| `tests/unit/reconcile-backfill.test.ts` | Backfill: Unit tests for date validation, cron auth, UPSERT DO NOTHING, response shape, active-sites query. |
| `supabase/migrations/20260217000000_pr9_ingest_idempotency_partitioning.sql` | PR-9: ingest_idempotency monthly RANGE(created_at) partitioning; PK (site_id, idempotency_key, created_at); copy under lock + swap; `ingest_idempotency_ensure_next_partition()`. |
| `supabase/migrations/20260217000001_pr9_ingest_idempotency_brin_fallback.sql` | PR-9 Option B: BRIN on created_at if partitioning postponed. |
| `docs/BILLING/PR9_IDEMPOTENCY_SCALING.md` | PR-9: Migration plan, EXPLAIN query plans, rollback plan. |
| `app/api/sync/route.ts` | PR-10: Optional SyncHandlerDeps (validateSite, checkRateLimit, getQuotaDecision, updateIdempotencyBillableFalse, publish, insertFallback, incrementUsageRedis) for financial gate tests. |
| `tests/unit/sync-financial-gate.test.ts` | PR-10: Integration tests for (1) duplicate → 200+dedup no publish, (2) db down → 500+billing_gate_closed no publish/fallback/redis, (3) quota reject → 429+quota-exceeded billable=false, (4) fallback → idempotency before fallback. |

---

## SQL Migration(s)

**20260215000000_ingest_idempotency_retention_90d.sql**

- Updates existing rows: `SET expires_at = created_at + INTERVAL '90 days'` where `expires_at` was shorter.
- Adds comment on `ingest_idempotency.expires_at`.

Index `idx_ingest_idempotency_expires_at` already exists from migration 20260214000000.

**20260216000000_revenue_kernel_pr1.sql** — Billing foundation: `billing_state` enum, `site_plans`, `site_usage_monthly`, `invoice_snapshot` (immutable), `ingest_idempotency` extended with `billing_state`, `billable`, `year_month` (generated), partial index.

**20260216000001_revenue_kernel_pr1_p0_p1.sql** — P0: `ingest_idempotency` SELECT for site members; no UPDATE/DELETE for authenticated; GRANT UPDATE to service_role. P1: `year_month` NOT NULL, partial index `(site_id, year_month, billing_state) WHERE billable`, `site_plans.updated_at` trigger.

**20260216000002_revenue_kernel_pr2_idempotency_version.sql** — PR-2: `idempotency_version` SMALLINT NOT NULL DEFAULT 1; index (site_id, year_month, idempotency_version) WHERE billable = true.

---

## Verification Steps (Production)

Replace `CONSOLE_URL` and `ORIGIN` with your production values (e.g. `https://console.opsmantik.com`).

**1. Duplicate: second request returns 200 + dedup, no publish**

```bash
# First request (should return queued or degraded)
curl -s -D - -X POST "CONSOLE_URL/api/sync" \
  -H "Content-Type: application/json" \
  -H "Origin: ORIGIN" \
  -d '{"s":"YOUR_SITE_PUBLIC_ID","url":"https://example.com","ec":"c","ea":"e","el":"l"}'

# Second request within same 5s (same payload) — expect 200, x-opsmantik-dedup: 1
curl -s -D - -X POST "CONSOLE_URL/api/sync" \
  -H "Content-Type: application/json" \
  -H "Origin: ORIGIN" \
  -d '{"s":"YOUR_SITE_PUBLIC_ID","url":"https://example.com","ec":"c","ea":"e","el":"l"}'
```

Expected on second response: `x-opsmantik-dedup: 1`, body `"status":"duplicate"`.

**2. Rate limit 429 (after exceeding limit)**

After enough requests to exceed limit (e.g. 100 in 60s):

```bash
curl -s -D - -X POST "CONSOLE_URL/api/sync" \
  -H "Content-Type: application/json" \
  -H "Origin: ORIGIN" \
  -d '{"s":"YOUR_SITE_PUBLIC_ID","url":"https://example.com"}'
```

Expected: `429`, header `x-opsmantik-ratelimit: 1`. No idempotency row for that request.

**3. Build-info headers (all successful sync responses)**

```bash
curl -s -D - -X POST "CONSOLE_URL/api/sync" ...
```

Expected headers: `x-opsmantik-commit`, `x-opsmantik-branch`.

**4. Degraded (QStash down) — fallback**

With QStash broken or unreachable, POST same as above. Expected: `200`, `x-opsmantik-degraded: qstash_publish_failed`, `x-opsmantik-fallback: true`. One row in `ingest_idempotency`, one in `ingest_fallback_buffer` for that request.

**5. PR-3 Quota 429 (monthly limit exceeded, or hard cap with soft limit)**

When site is at or over monthly limit (and soft_limit_enabled=false, or at hard_cap with soft_limit_enabled=true):

```bash
curl -s -D - -X POST "CONSOLE_URL/api/sync" \
  -H "Content-Type: application/json" \
  -H "Origin: ORIGIN" \
  -d '{"s":"YOUR_SITE_PUBLIC_ID","url":"https://example.com","ec":"c","ea":"e","el":"l"}'
```

Expected: `429`, header `x-opsmantik-quota-exceeded: 1`, header `Retry-After: <seconds>`, body `{"status":"rejected_quota"}`. No publish, no fallback. The idempotency row for this request must have `billable = false` (see DB verification below).

**6. PR-3 Overage 200 (soft limit, over limit but under hard cap)**

When site has soft_limit_enabled=true and usage is between monthly_limit and hard_cap:

```bash
curl -s -D - -X POST "CONSOLE_URL/api/sync" ...
```

Expected: `200`, header `x-opsmantik-overage: true`, request is accepted and billable as overage.

---

## Go/No-Go Checklist

| Item | Status |
|------|--------|
| ingest_idempotency.expires_at >= 90 days (computed server-side) | Go |
| No code path derives invoice from Redis / events / sessions / fallback | Go (banner + audit) |
| Order: Auth → Rate limit → Idempotency → Quota → Publish | Go |
| Duplicate: 200 + x-opsmantik-dedup: 1, no publish | Go |
| 429 rate limit: x-opsmantik-ratelimit: 1, no idempotency insert | Go |
| PR-3 Quota: 429 x-opsmantik-quota-exceeded, Retry-After; reject path billable=false, no publish/fallback | Go |
| PR-3 Overage: 200 + x-opsmantik-overage: true, billing_state=OVERAGE | Go |
| PR gate tests: dedup, order, quota reject, billable=false, expires_at | Go |
| Migration backfill + cleanup job doc | Go |
| Quota engine (lib/quota.ts + route integration) | Go (PR-3) |

**Overall: Go** — Revenue Kernel invariants implemented and verified per frozen spec.

---

## DB-level smoke (after `db push`)

Prod’da service_role ile 30 saniyede doğrula:

**1. `ingest_idempotency.year_month` formatı `YYYY-MM` mi?**

```sql
SELECT DISTINCT year_month FROM public.ingest_idempotency LIMIT 12;
-- Tüm değerler '2025-01', '2025-02', ... gibi olmalı (regex: ^\d{4}-\d{2}$)
```

**2. `invoice_snapshot` update/delete gerçekten engelleniyor mu?**

```sql
-- Önce bir satır ekle (service_role)
INSERT INTO public.invoice_snapshot (site_id, year_month, event_count, overage_count, snapshot_hash)
SELECT id, '2025-01', 0, 0, 'test' FROM public.sites LIMIT 1
ON CONFLICT (site_id, year_month) DO NOTHING;

-- Aşağıdakiler FAIL etmeli (immutable):
UPDATE public.invoice_snapshot SET event_count = 1 WHERE year_month = '2025-01';
DELETE FROM public.invoice_snapshot WHERE year_month = '2025-01';
```

**3. Site member `ingest_idempotency` üzerinde update yapabiliyor mu? (Yapmamalı — P0)**

Authenticated bir kullanıcı ile (site member JWT):

```sql
-- Bu UPDATE 0 row etkilemeli veya RLS ile reddedilmeli (authenticated'ın UPDATE yetkisi yok).
UPDATE public.ingest_idempotency SET billable = false WHERE site_id = '...';
-- Beklenen: permission denied veya 0 rows updated (RLS + no UPDATE grant).
```

Service_role dışında `ingest_idempotency` üzerinde UPDATE/DELETE grant’i olmamalı; site member sadece SELECT (kendi site’ı) yapabilir.

**4. PR-3: Rejected quota rows have billable=false**

After triggering a quota 429 (site over limit, or at hard cap), verify the idempotency row for that request is not billable:

```sql
-- Find recent idempotency rows for a site that hit quota (e.g. by created_at and site_id).
-- Those that were rejected by quota (same time window as 429 response) should have billable = false.
SELECT site_id, idempotency_key, created_at, billable, billing_state
FROM public.ingest_idempotency
WHERE site_id = 'YOUR_SITE_UUID'
  AND created_at >= NOW() - INTERVAL '5 minutes'
ORDER BY created_at DESC
LIMIT 20;
```

For requests that returned 429 with `status: rejected_quota`, the corresponding row (same second/window) must have `billable = false`. Invoice SoT remains COUNT(*) WHERE billable = true only.

---

## PR-4: Reconciliation cron (self-healing site_usage_monthly)

**Invariant:** Invoice SoT remains `ingest_idempotency` (billable=true). Reconciliation never changes invoice authority. Redis is performance-only; reconciliation may optionally correct Redis (best-effort).

### How to enqueue and run cron in prod

**Recommended (PR-4.1):** Single GET — enqueue then claim+run in one call. Idempotent, safe for frequent schedules.

```bash
# Unified: enqueue + run (up to 50 jobs per request)
curl -s -X GET "https://YOUR_DOMAIN/api/cron/reconcile-usage" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
# Or with Vercel Cron: x-vercel-cron: 1
```

Response: `{ ok: true, enqueued, processed, completed, failed, request_id }`.

**Optional (split endpoints):**  
- GET `/api/cron/reconcile-usage/enqueue` — enqueue only.  
- POST `/api/cron/reconcile-usage/run` — claim+run only (limit 50).

### Backfill (reconciliation jobs for a date range)

**Route:** `POST /api/cron/reconcile-usage/backfill`  
**Auth:** Same as above (requireCronAuth: `x-vercel-cron: 1` or `Authorization: Bearer CRON_SECRET`).

**Body:** `{ site_id?: uuid, from: 'YYYY-MM', to: 'YYYY-MM' }`

- `from`, `to`: required; must be valid YYYY-MM; `from` ≤ `to`; range length ≤ 12 months.
- `site_id`: optional; if omitted, “active” sites are those with at least one row in `ingest_idempotency` with `year_month` in `[from, to]`.

**Behavior:** For each month in `[from, to]` and each site (the given site or all active sites), inserts into `billing_reconciliation_jobs` with **UPSERT ON CONFLICT (site_id, year_month) DO NOTHING** so only missing jobs are enqueued.

**Response:** `{ ok: true, enqueued: number, months: string[], sites: number }` (or 400 for invalid body/range, 500 on DB error).

### DB query: verify site_usage_monthly matches COUNT(ingest_idempotency)

After reconciliation has run, usage in `site_usage_monthly` must match the billable count from `ingest_idempotency`:

```sql
-- Compare site_usage_monthly.event_count vs COUNT(ingest_idempotency) per (site_id, year_month)
SELECT
  u.site_id,
  u.year_month,
  u.event_count AS usage_event_count,
  u.last_synced_at,
  (SELECT COUNT(*) FROM public.ingest_idempotency i
   WHERE i.site_id = u.site_id AND i.year_month = u.year_month AND i.billable = true) AS pg_billable_count
FROM public.site_usage_monthly u
WHERE u.year_month >= to_char(NOW() - INTERVAL '2 months', 'YYYY-MM')
ORDER BY u.site_id, u.year_month;
-- usage_event_count should equal pg_billable_count for reconciled rows (last_synced_at recent).
```

### Drift definition and thresholds

- **Drift:** Difference between Redis usage key and Postgres billable count for the same (site_id, year_month).
- **abs:** `|redis - pg_count_billable|`
- **pct:** `abs / pg_count_billable` when pg_count_billable > 0.
- **Correction threshold:** Reconciliation corrects Redis when `abs > max(10, pg_count_billable * 0.01)` (i.e. > 10 or > 1%).
- **Watchtower:** `billingReconciliationDriftLast1h` = number of distinct sites with `last_drift_pct > 0.01` on completed jobs in the last 1 hour. Status `degraded` when count > 0.

---

## PR-4 Canary validation (tek site → full rollout)

**Canary:** Tek site seç (örn. sosreklam.com `site_id`). UTC ay: Şubat 2026 = `2026-02`.

### 0) Değişkenler (doldur)

```powershell
$CONSOLE_URL = "https://console.opsmantik.com"
$CRON_SECRET = "YOUR_CRON_SECRET"
# Canary site UUID (Supabase sites.id)
$CANARY_SITE_UUID = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
$YEAR_MONTH = "2026-02"
```

### 1) Cron endpoint’leri manuel çalıştır

**1) Unified cron (önerilen)**

```powershell
curl.exe -s -D - -X GET "$CONSOLE_URL/api/cron/reconcile-usage" `
  -H "Authorization: Bearer $CRON_SECRET"
```

Beklenen: **200**, body: `{ ok: true, enqueued, processed, completed, failed, request_id }`.

**Alternatif (ayrık):** GET `/api/cron/reconcile-usage/enqueue` sonra POST `/api/cron/reconcile-usage/run`.

### 2) DB proof (canary site)

Supabase SQL Editor’da (CANARY_SITE_UUID ve 2026-02’yi değiştir):

```sql
-- (A) SoT: ingest_idempotency billable count
SELECT count(*) AS billable
FROM ingest_idempotency
WHERE site_id = '<CANARY_SITE_UUID>'
  AND year_month = '2026-02'
  AND billable = true;

-- (B) Reconciled: site_usage_monthly snapshot
SELECT event_count, overage_count, last_synced_at
FROM site_usage_monthly
WHERE site_id = '<CANARY_SITE_UUID>'
  AND year_month = '2026-02';
```

Beklenen: `site_usage_monthly.event_count` = (A) billable; `last_synced_at` yakın zamanda.

### 3) Job tablosu (claim/complete kanıtı)

```sql
SELECT site_id, year_month, status, attempt_count, last_error, last_drift_pct, updated_at
FROM billing_reconciliation_jobs
WHERE site_id = '<CANARY_SITE_UUID>'
ORDER BY updated_at DESC
LIMIT 20;
```

Beklenen: `status = 'COMPLETED'`, `last_error` null.

### 4) Watchtower (drift check)

```powershell
curl.exe -s -D - -X GET "$CONSOLE_URL/api/cron/watchtower" `
  -H "Authorization: Bearer $CRON_SECRET"
```

Beklenen: `billingReconciliationDriftLast1h`: 0 veya düşük.

### 5) Full rollout için gönderilecek proof (bu bloğu doldurup at)

Canary temizse aşağıyı doldurup ilgili kişiye at; “✅ GO — Full Rollout” onayı ile cron schedule kilitlenir.

```
--- PR-4 Canary proof ---

Unified GET /api/cron/reconcile-usage:
  Status: 
  Headers (ilk birkaç satır): 
  Body (kısa): enqueued=…, processed=…, completed=…, failed=… 

DB (A) billable count: 
DB (B) site_usage_monthly: event_count=..., overage_count=..., last_synced_at=...

Jobs (canary): status=..., last_error=..., last_drift_pct=...

Watchtower billingReconciliationDriftLast1h: 

--- End proof ---
```

**Önerilen cron:** GET `/api/cron/reconcile-usage` tek endpoint, 5–15 dk aralıkla (unified: enqueue + run tek istekte).

---

## PR-6: Invoice snapshot freeze

**Route:** `POST /api/cron/invoice-freeze` — auth: `requireCronAuth`. Freezes **previous month only (UTC)** from `site_usage_monthly`. For each site with activity: INSERT into `invoice_snapshot` (site_id, year_month, event_count, overage_count, snapshot_hash, generated_at, generated_by). **snapshot_hash** = SHA256(site_id + year_month + event_count + overage_count + commit_sha). **Idempotency:** ON CONFLICT (site_id, year_month) DO NOTHING. Response: `{ ok, year_month, inserted, skipped, total_sites, request_id }`.

**Dispute-proof (invoice authority):**  
- **Invoice uses snapshot if it exists:** For a given (site_id, year_month), if a row exists in `invoice_snapshot`, that row is the authoritative billable count for dispute and export.  
- **Else falls back to COUNT(ingest_idempotency):** If no snapshot exists (e.g. freeze not yet run), the canonical source remains `COUNT(*) FROM ingest_idempotency WHERE site_id = ? AND year_month = ? AND billable = true`.  
- `invoice_snapshot` is immutable (trigger blocks UPDATE/DELETE); snapshot_hash ties the frozen numbers to the deployment (commit_sha) for audit.

---

## PR-7: Dispute export

**Route:** `GET /api/billing/dispute-export?site_id=...&year_month=YYYY-MM`  
**Auth:** RBAC — user must have `billing:view` (owner, admin, or billing role) and access to the site. Tenant-scoped: export only for sites the user owns or is a member of.

**Output:** CSV (stream) with columns: `created_at`, `idempotency_key`, `idempotency_version`, `billing_state`, `billable`. Deterministic ordering: `ORDER BY created_at ASC, id ASC`.

**Headers:**  
- `x-opsmantik-snapshot-hash`: set when an `invoice_snapshot` row exists for (site_id, year_month).  
- `x-opsmantik-export-hash`: SHA256 of the CSV bytes (UTF-8).

**Log:** `BILLING_DISPUTE_EXPORT` with `site_id`, `year_month`, `row_count`, `export_hash`.

---

## PR-8: Billing observability

**Sync counters (in-memory + BILLING_METRIC log):**  
`billing_ingest_allowed_total`, `billing_ingest_duplicate_total`, `billing_ingest_rejected_quota_total`, `billing_ingest_rate_limited_total`, `billing_ingest_overage_total`, `billing_ingest_degraded_total`.

**Reconciliation counters:**  
`billing_reconciliation_runs_ok_total`, `billing_reconciliation_runs_failed_total`.  
**Drift:** `billing_reconciliation_drift_sites_last1h` (from DB: sites with last_drift_pct > 1% in last 1h).

**Exposure:**  
- **GET /api/metrics** — cron or admin auth; returns JSON with all counters + `billing_reconciliation_drift_sites_last1h`.  
- **Watchtower** — GET /api/cron/watchtower response includes `billing_metrics` (same counters + drift).

---

## PR-8: Billing observability

**Sync counters (in-memory + BILLING_METRIC log):**  
`billing_ingest_allowed_total`, `billing_ingest_duplicate_total`, `billing_ingest_rejected_quota_total`, `billing_ingest_rate_limited_total`, `billing_ingest_overage_total`, `billing_ingest_degraded_total`.

**Reconciliation counters:**  
`billing_reconciliation_runs_ok_total`, `billing_reconciliation_runs_failed_total`.  
**Drift:** `billing_reconciliation_drift_sites_last1h` (from DB: sites with last_drift_pct > 1% in last 1h).

**Exposure:**  
- **GET /api/metrics** — cron or admin auth; returns JSON with all counters + `billing_reconciliation_drift_sites_last1h`.  
- **Watchtower** — GET /api/cron/watchtower response includes `billing_metrics` (same counters + drift).
