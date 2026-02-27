# Sprint 2 — Financial Value Correction & Storage Hygiene — Verification Report

**Initiative:** Financial Value Correction & Storage Hygiene  
**Status:** ✅ Implemented

---

## 1. OCI Value Correction (Last-Minute Sync)

### 1.1 Behavior

| Check | Result | Evidence |
|-------|--------|----------|
| Worker re-reads calls before send | ✅ | `lib/oci/runner.ts`: `syncQueueValuesFromCalls(siteIdUuid, siteRows, prefix)` is called **before** building jobs in both **worker** and **cron** paths. |
| Only rows with `call_id` are synced | ✅ | `syncQueueValuesFromCalls` filters `siteRows.filter((r) => r.call_id)`; sale-originated rows (no `call_id`) are unchanged. |
| Fresh value from `calls` + site OCI config | ✅ | Fetches `calls.lead_score`, `sale_amount`, `currency`; loads `sites.oci_config`; uses `parseOciConfig`, `computeConversionValue` (same formula as enqueue). |
| Queue row updated when value differs | ✅ | If `freshCents !== row.value_cents`, in-memory `row.value_cents` is updated and `offline_conversion_queue` is updated via `adminClient.from('offline_conversion_queue').update({ value_cents, updated_at }).eq('id', id)`. |
| Google Ads receives updated value | ✅ | Jobs are built **after** sync via `queueRowToConversionJob(r)`, which uses `row.value_cents` → `job.amount_cents`. |

### 1.2 Code References

- **Sync function:** `lib/oci/runner.ts` — `syncQueueValuesFromCalls()` (re-reads calls, applies OCI config, updates queue and in-memory rows).
- **Worker path:** Same file, immediately before `const adapter = getProvider(providerKey)` and `const jobs = siteRows.map(...)`.
- **Cron path:** Same file, immediately before `const adapter = getProvider(providerKey)` and `const jobs = rowsToProcess.map(queueRowToConversionJob)`.
- **QueueRow:** `lib/cron/process-offline-conversions.ts` — `QueueRow` includes optional `call_id` for value sync.

### 1.3 How to Verify

1. Enqueue a conversion (seal a call) with a given value.
2. Before the worker runs, update the call’s `lead_score` or `sale_amount` in the DB.
3. Run the worker (or cron); check logs for `OCI_VALUE_SYNC` with `updated_count > 0` when the value changed.
4. Confirm the request sent to Google Ads uses the new value (e.g. via adapter logs or Google Ads UI).

---

## 2. Zombie Cleanup (RPC & Cron)

### 2.1 RPC: `cleanup_oci_queue_batch(p_days_to_keep, p_limit)`

| Check | Result | Evidence |
|-------|--------|----------|
| Deletes only COMPLETED / FATAL / FAILED | ✅ | Migration `20260327000000_sprint2_cleanup_oci_queue_and_auto_junk.sql`: `WHERE status IN ('COMPLETED', 'FATAL', 'FAILED')`. |
| Respects age threshold | ✅ | `updated_at < now() - (p_days_to_keep || ' days')::interval`; `p_days_to_keep` clamped to 1–365. |
| Batch limit | ✅ | `LIMIT LEAST(GREATEST(p_limit, 1), 10000)` in the CTE; deletes only those IDs. |
| Service_role only | ✅ | `IF auth.role() <> 'service_role' THEN RAISE EXCEPTION ...` |
| Returns deleted count | ✅ | `GET DIAGNOSTICS v_deleted = ROW_COUNT; RETURN v_deleted;` |

### 2.2 Cron Route: `POST /api/cron/cleanup`

| Check | Result | Evidence |
|-------|--------|----------|
| Auth | ✅ | `requireCronAuth(req)`; returns 403 when unauthorized. |
| Calls OCI cleanup RPC | ✅ | `adminClient.rpc('cleanup_oci_queue_batch', { p_days_to_keep: daysToKeep, p_limit: limit })`. |
| Query params | ✅ | `days_to_keep` (default 90), `limit` (default 5000), `dry_run=true` for count-only. |
| Response shape | ✅ | `{ ok, oci_queue: { deleted, days_to_keep, limit }, auto_junk: { updated, ... }, note? }`. |

---

## 3. 7-Day Auto-Junk (Scavenger)

### 3.1 RPC: `cleanup_auto_junk_stale_intents(p_days_old, p_limit)`

| Check | Result | Evidence |
|-------|--------|----------|
| Targets intent / NULL only | ✅ | `WHERE (status = 'intent' OR status IS NULL)`. |
| Age threshold | ✅ | `created_at < now() - (p_days_old || ' days')::interval`; default 7 days, clamped 1–365. |
| Sets status to junk | ✅ | `UPDATE public.calls SET status = 'junk', updated_at = now() WHERE id IN (SELECT id FROM to_junk)`. |
| Batch limit | ✅ | `LIMIT LEAST(GREATEST(p_limit, 1), 10000)` in CTE. |
| Service_role only | ✅ | Same auth check as OCI cleanup RPC. |

### 3.2 Cron Route

| Check | Result | Evidence |
|-------|--------|----------|
| Calls auto-junk RPC | ✅ | `adminClient.rpc('cleanup_auto_junk_stale_intents', { p_days_old: daysOldIntents, p_limit: limitIntents })`. |
| Defaults | ✅ | `days_old_intents=7`, `limit_intents=5000`; overridable via query params. |
| Same endpoint as OCI cleanup | ✅ | Single `POST /api/cron/cleanup` runs both OCI queue cleanup and auto-junk in one request. |

---

## 4. Files Touched

| File | Change |
|------|--------|
| `lib/cron/process-offline-conversions.ts` | Added `call_id` (optional) to `QueueRow`. |
| `lib/oci/runner.ts` | Import `parseOciConfig`, `computeConversionValue`; added `syncQueueValuesFromCalls()`; call it before building jobs in worker and cron paths. |
| `supabase/migrations/20260327000000_sprint2_cleanup_oci_queue_and_auto_junk.sql` | New: `cleanup_oci_queue_batch`, `cleanup_auto_junk_stale_intents`. |
| `app/api/cron/cleanup/route.ts` | New: POST handler with cron auth; dry_run; calls both RPCs; returns deleted/updated counts. |

---

## 5. Deployment Checklist

- [ ] Apply migration: `supabase db push` or run `20260327000000_sprint2_cleanup_oci_queue_and_auto_junk.sql`.
- [ ] Deploy app (runner + cron cleanup route).
- [ ] Schedule daily cron for `POST /api/cron/cleanup` (e.g. Vercel Cron or GitHub Actions) with `Authorization: Bearer <CRON_SECRET>`.
- [ ] Optional: run once with `?dry_run=true` to confirm counts, then without for first real run.

---

## 6. Quick Verification Commands

```bash
# Dry run (no DB changes)
curl -X POST "https://<APP_URL>/api/cron/cleanup?dry_run=true" -H "Authorization: Bearer $CRON_SECRET"

# Real run (defaults: 90 days OCI, 7 days auto-junk, 5000 batch each)
curl -X POST "https://<APP_URL>/api/cron/cleanup" -H "Authorization: Bearer $CRON_SECRET"
```

Expected: `200` and JSON with `ok: true`, `oci_queue.deleted` / `oci_queue.would_delete`, `auto_junk.updated` / `auto_junk.would_update`.

---

**Sprint 2 Verification Report — End**
