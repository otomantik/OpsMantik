# Billing: `conversion_sends` SSOT

**Single-sentence SSOT:** `usage_counters.conversion_sends_count` (incremented **only** inside Postgres by `public.increment_oci_conversion_sends_v1` for OCI export) is an **OpsMantik-side monthly cap counter** for billable conversion **dispatch / pipeline** events — it is **not** a count of Google Ads offline conversions that Google has financially or import-log “confirmed”.

## Trace (where the knob exists today)

- **RPC (OCI export only):** `public.increment_oci_conversion_sends_v1(p_site_id, p_month, p_queue_ids uuid[], p_limit)` — service_role only. Locks `usage_counters` for `(site_id, month)`, counts rows in `p_queue_ids` that are **not** yet in `oci_conversion_send_billing_ledger`, enforces `p_limit` on `(current + new_rows)` **before** inserting, then inserts ledger rows `ON CONFLICT (queue_id) DO NOTHING` and adds `conversion_sends_count` by the number of rows actually inserted. **Node must not** read-modify-write `usage_counters` for this purpose.
- **Legacy RPC:** `public.increment_usage_checked(..., 'conversion_sends', ...)` remains available for older callers; the **authoritative** OCI export path uses `increment_oci_conversion_sends_v1` only.
- **Product ingest path:** `lib/ingest/sync-gates.ts` increments **`revenue_events`** only after a fresh idempotency insert passes quota + entitlements.
- **OCI Google Ads export (single hook):** `conversion_sends` is debited in `app/api/oci/google-ads-export/export-mark-processing.ts` via `incrementConversionSendsForExportClaim(siteId, queueIds)` (`lib/billing/increment-conversion-sends-export.ts`), which validates `queueIds` with `ociConversionSendBillingQueueIdsSchema` (Zod) and calls `increment_oci_conversion_sends_v1` with the **same** UUID set passed next to `append_script_claim_transition_batch`. Runs **immediately before** claim when `markAsExported` and `keptConversions.length > 0`, so **`CONVERSION_SENDS_LIMIT`** (HTTP 429) returns **without** transitioning rows to `PROCESSING`. Billing is **per distinct `offline_conversion_queue.id` first dispatch**, not per HTTP retry: duplicate retries add **zero** additional debits once a `queue_id` row exists in `oci_conversion_send_billing_ledger`.
- **Entitlements shape:** `lib/entitlements/types.ts` → `limits.monthly_conversion_sends` documents the SSOT link in-line.

## Idempotency + LIMIT semantics

- **Idempotency (ingest):** duplicate ingest events must not double-count `revenue_events` because `tryInsertIdempotencyKey` short-circuits before `increment_usage_checked`.
- **Idempotency (`conversion_sends`):** `oci_conversion_send_billing_ledger.queue_id` PRIMARY KEY guarantees **at most one lifetime billing row per queue row**. Retries / concurrent export calls that resubmit the same `queue_id` set get `billed_new = 0` for already-ledgered ids; `usage_counters` increases only by newly inserted ledger rows.
- **LIMIT:** the RPC returns `{ ok:false, reason:'LIMIT' }` when `p_limit >= 0` and `current + unbilled_batch_count > p_limit` **before** any ledger insert for that call. The export route surfaces **`CONVERSION_SENDS_LIMIT`** (HTTP 429) when the hook returns LIMIT **before** queue claim.

## Operator / finance language

Do **not** describe `monthly_conversion_sends` as “provider-confirmed revenue” or “Google accepted conversions.” It is a **platform usage counter** aligned to **export dispatch** (claim batch), not Google import confirmation.
