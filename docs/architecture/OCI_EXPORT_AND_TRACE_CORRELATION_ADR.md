# ADR: OCI export abuse controls and trace correlation (L16–L17)

## Status

Accepted — documents existing behavior and correlation contract; no breaking API change.

## Context

- **L16:** Google Ads export (`/api/oci/google-ads-export`) is authenticated (session bearer or `x-api-key`) and must resist brute-force / site-id guessing without starving legitimate scripts.
- **L17:** Operators need one key to correlate HTTP handling, outbox rows, and worker logs.

## Decision

### Export rate limiting (L16)

- Successful auth resolves a `siteId` and applies a per-site rate limit via `RateLimitService.checkWithMode` with namespace **`oci-google-ads-export`** and **`fail-open`** when Redis is unavailable (export continues; abuse risk is accepted vs hard outage).
- Failed auth (missing bearer and key) uses a separate tight bucket: namespace **`oci-authfail`**, **`fail-closed`**, to slow unauthenticated probing.

Implementation: `app/api/oci/google-ads-export/export-auth.ts`.

### Trace correlation (L17)

- HTTP **`request_id`** (or equivalent UUID generated per request in panel routes) is passed as `enqueuePanelStageOciOutbox(..., { requestId })`.
- When present, the producer sets **`outbox_events.payload.request_id`** on `IntentSealed` inserts so Supabase rows align with edge logs and Sentry.

Implementation: `lib/oci/enqueue-panel-stage-outbox.ts` (`PanelStageOciEnqueueOptions.requestId`).

### What we are not doing (yet)

- OpenTelemetry spans for `oci.producer.decision` remain optional backlog.
- Export JSON responses do not require `request_id` in every branch; correlation for export failures should use the caller’s request id from the edge layer plus `siteId` and timestamps.

## Consequences

- Dashboards and Metabase can join `outbox_events.payload->>'request_id'` to request logs where the producer ran.
- Security audits should treat **`oci-google-ads-export`** as intentionally fail-open on Redis; tighten to fail-closed only with product sign-off (risk: export outage during Redis incidents).
