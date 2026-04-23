# Intent gclid Chain Audit

This document traces `gclid` / `wbraid` / `gbraid` from ingress to persistence and export.

## 1) Ingress

- Tracker sends click identifiers from `lib/tracker/tracker.js`.
- Sync pipeline reads `meta.gclid`, `meta.wbraid`, `meta.gbraid` in `lib/ingest/process-sync-event.ts`.
- Call-event path sends click identifiers in `lib/ingest/process-call-event.ts`.

## 2) Sanitization and gating

- `sanitizeClickId(...)` in `lib/attribution.ts` can null invalid values.
- `hasValidClickId(...)` in `lib/ingest/bot-referrer-gates.ts` enforces click-id validity in debloat decisions.
- Consent gates in `app/api/sync/route.ts` and call-event routes can return early before persistence.

## 3) Persistence targets

- Sessions: `sessions.gclid`, `sessions.wbraid`, `sessions.gbraid` via `lib/services/session-service.ts`.
- Events: `events.metadata.gclid` (and related metadata) via `lib/services/event-service.ts`.
- Calls: `calls.click_id`, `calls.gclid`, `calls.wbraid`, `calls.gbraid` via `lib/ingest/process-call-event.ts`.
- Export staging: `marketing_signals` and `offline_conversion_queue` via `lib/domain/mizan-mantik/upsert-marketing-signal.ts` and `lib/oci/enqueue-seal-conversion.ts`.

## 4) Hard/soft drop points

1. `consent_missing`  
   Sync/call event exits before write if required consent is absent.

2. `debloat_skip`  
   Bot/referrer + invalid click-id combination can skip write path.

3. `invalid_click_id`  
   `sanitizeClickId` rejects malformed/short/template-like values.

4. `organic_nulling`  
   Session update/create logic can null braid fields for organic classification.

5. `schema_drift_strip`  
   Call insert fallback can remove columns when DB schema is behind runtime expectations.

## 5) Integrity checks (must pass)

Use one controlled signal containing known `gclid` and verify:

1. Request payload includes `meta.gclid` (or top-level in call-event).
2. Same request produces row in `processed_signals`.
3. Related `sessions` row has non-null `gclid` when not dropped by policy.
4. Related `events` row metadata preserves click-id data.
5. Related `calls` row has non-null click-id fields.
6. Export mapper (`lib/providers/google_ads/mapper.ts`) emits a candidate, not `null`.

## 6) Simplification rule

Standardize drop telemetry codes across sync/call-event/worker:

- `consent_missing`
- `debloat_skip`
- `invalid_click_id`
- `schema_drift_strip`

Any click-id loss must map to one of these codes in logs/metrics.
