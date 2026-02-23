# Non-Zero Workload Proof — Cron Bulk Endpoints

**Date:** 2026-02-22  
**Environment:** Production (https://console.opsmantik.com)

---

## 1. SQL Counts (Before Seed)

| Metric | Count |
|--------|-------|
| `offline_conversion_queue` eligible (QUEUED/RETRY, next_retry_at eligible) | 0 |
| `site_usage_monthly` (freeze month 2026-01) | 12 |
| `ingest_fallback_buffer` PENDING | 0 |

---

## 2. Seed Actions

- **OCI:** Inserted 1 sale + 1 `offline_conversion_queue` row (QUEUED) for site `e47f36f6-c277-4879-b2dc-07914a0632c2`
- **Freeze:** Not seeded (12 rows already present; all likely already in `invoice_snapshot`)
- **Recover:** No seed mechanism (requires real QStash failure)

---

## 3. Cron Runs (After Seed)

| Endpoint | HTTP | Response |
|----------|------|----------|
| POST `/api/cron/process-offline-conversions?limit=10` | 200 | `{"ok":true,"processed":1,"completed":0,"failed":1,"retry":0}` |
| POST `/api/cron/invoice-freeze` | 200 | `{"ok":true,"year_month":"2026-01","frozen":0,"failed":0}` |
| GET `/api/cron/recover` | 200 | `{"ok":true,"claimed":0,"recovered":0,"failed":0}` |

---

## 4. Evidence Summary

| Metric | Value |
|--------|-------|
| **oci_eligible_before** | 0 → 1 (after seed) |
| **processed_after** | 1 |
| **frozen_after** | 0 |
| **claimed_after** | 0 |
| **non_zero** | **true** (processed > 0) |

OCI bulk path executed with 1 row: claimed → adapter call → FAILED (fake GCLID) → bulk update to `offline_conversion_queue`.

---

## 5. Structured Bulk Logs

Bulk operations emit structured logs when workload > 0:

| Source | Event | Fields |
|--------|-------|--------|
| `lib/oci/runner.ts` | `OCI_BULK_UPDATE` | `idsCount`, `chunks`, `durationMs`, `prefix` |
| `app/api/cron/invoice-freeze` | `INVOICE_FREEZE_BULK` | `idsCount`, `chunks`, `durationMs`, `frozen`, `failed` |
| `app/api/cron/recover` | `RECOVER_FALLBACK_BULK` | `recoveredIdsCount`, `recoveredChunks`, `pendingIdsCount`, `durationMs` |

Example (Vercel logs):

```json
{"event":"OCI_BULK_UPDATE","idsCount":1,"chunks":1,"durationMs":45,"prefix":"[process-offline-conversions]"}
```

---

## 6. Raw Proof Log

See `cron-bulk-nonzero-proof.log` in this directory.

---

## 7. How to Run

```powershell
# With seed (creates minimal test rows if counts are zero)
$env:SMOKE_BASE_URL="https://console.opsmantik.com"
node scripts/smoke/cron-bulk-nonzero-proof.mjs --seed

# Or via npm
npm run smoke:cron-bulk-nonzero -- --seed
```

Required env: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`
