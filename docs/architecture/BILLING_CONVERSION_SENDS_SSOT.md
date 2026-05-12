# Billing: `conversion_sends` SSOT

**Single-sentence SSOT:** `usage_counters.conversion_sends_count` (incremented only via `increment_usage_checked(..., p_kind := 'conversion_sends')`) is an **OpsMantik-side monthly cap counter** for billable conversion **dispatch / pipeline** events — it is **not** a count of Google Ads offline conversions that Google has financially or import-log “confirmed”.

## Trace (where the knob exists today)

- **RPC:** `public.increment_usage_checked(p_site_id, p_month, p_kind, p_limit)` — `p_kind IN ('revenue_events','conversion_sends')`; atomic `FOR UPDATE` row in `usage_counters`.
- **Product ingest path:** `lib/ingest/sync-gates.ts` increments **`revenue_events`** only after a fresh idempotency insert passes quota + entitlements.
- **OCI Google Ads export (single hook):** `conversion_sends` is debited in `app/api/oci/google-ads-export/export-mark-processing.ts` via `incrementConversionSendsForExportClaim` (`lib/billing/increment-conversion-sends-export.ts`), which calls `increment_usage_checked(..., 'conversion_sends', limits.monthly_conversion_sends)`. This runs **once per export HTTP request** that actually returns Google-bound queue rows (`markAsExported` and `keptConversions.length > 0`), **immediately before** `append_script_claim_transition_batch`, so quota exhaustion returns **`CONVERSION_SENDS_LIMIT`** without transitioning rows to `PROCESSING`. It is **not** per individual queue row, per ACK, or per script finalize — those remain out of scope for this counter unless this SSOT is revised.
- **Entitlements shape:** `lib/entitlements/types.ts` → `limits.monthly_conversion_sends` documents the SSOT link in-line.

## Idempotency + LIMIT semantics

- **Idempotency:** duplicate ingest events must not double-count `revenue_events` because `tryInsertIdempotencyKey` short-circuits before `increment_usage_checked`.
- **`conversion_sends`:** the RPC returns `{ ok:false, reason:'LIMIT' }` when `p_limit >= 0` and the next increment would exceed the cap; callers must treat that as a hard reject (same pattern as `revenue_events` in `runSyncGates`). The export route surfaces **`CONVERSION_SENDS_LIMIT`** (HTTP 429) from `export-mark-processing.ts` when the hook returns LIMIT **before** queue claim.

## Operator / finance language

Do **not** describe `monthly_conversion_sends` as “provider-confirmed revenue” or “Google accepted conversions.” It is a **platform usage counter** aligned to the **export claim batch** hook in Trace (one increment per qualifying export request, not per Google import confirmation).
