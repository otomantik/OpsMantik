# Billing: `conversion_sends` SSOT

**Single-sentence SSOT:** `usage_counters.conversion_sends_count` (incremented only via `increment_usage_checked(..., p_kind := 'conversion_sends')`) is an **OpsMantik-side monthly cap counter** for billable conversion **dispatch / pipeline** events — it is **not** a count of Google Ads offline conversions that Google has financially or import-log “confirmed”.

## Trace (where the knob exists today)

- **RPC:** `public.increment_usage_checked(p_site_id, p_month, p_kind, p_limit)` — `p_kind IN ('revenue_events','conversion_sends')`; atomic `FOR UPDATE` row in `usage_counters`.
- **Product ingest path:** `lib/ingest/sync-gates.ts` increments **`revenue_events`** only after a fresh idempotency insert passes quota + entitlements; **`conversion_sends` is not wired here yet** — reserved for a single future choke point when OCI/export billing should debit the cap deterministically (claim, worker completion, or another agreed event — document that choice in this file when implemented).
- **Entitlements shape:** `lib/entitlements/types.ts` → `limits.monthly_conversion_sends` documents the SSOT link in-line.

## Idempotency + LIMIT semantics

- **Idempotency:** duplicate ingest events must not double-count `revenue_events` because `tryInsertIdempotencyKey` short-circuits before `increment_usage_checked`.
- **`conversion_sends`:** the RPC returns `{ ok:false, reason:'LIMIT' }` when `p_limit >= 0` and the next increment would exceed the cap; callers must treat that as a hard reject (same pattern as `revenue_events` in `runSyncGates`).

## Operator / finance language

Do **not** describe `monthly_conversion_sends` as “provider-confirmed revenue” or “Google accepted conversions.” It is a **platform usage counter** aligned to whatever single increment hook the team wires (see Trace).
