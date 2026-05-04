# ADR: Optional pre-insert dedupe for `outbox_events` (IntentSealed)

## Status

Proposed — not implemented by default.

## Context

Panel operators can generate many `outbox_events` rows for the same `call_id` in a short window (burst scoring, retries). The worker applies **single-conversion gear** rules and idempotent marketing signal keys, so correctness is preserved, but **queue depth** and **claim load** grow.

## Decision (recommended direction)

If product requires hard cap on duplicate PENDING work per call:

1. **Partial unique index** (example sketch): unique on `(site_id, call_id, (payload->>'stage'))` **where** `status = 'PENDING'` and `event_type = 'IntentSealed'`. Postgres allows expression/partial unique indexes but migration must match exact JSON shape.
2. **Alternative:** `INSERT … ON CONFLICT DO NOTHING` into a staging constraint — requires stable conflict target.
3. **Risk:** blocking a legitimate lower-gear PENDING when a higher gear is still only in `marketing_signals` but not yet visible to the producer check — align with `process-outbox` skip rules before enabling.

## Consequences

- Fewer PENDING rows; simpler ops graphs.
- Migration + rollback plan required; wrong predicate can drop legitimate precursors.
- Producer must treat conflict as **success** (row already queued) and still return `oci_outbox_inserted` semantics consistent with clients.

## Links

- Worker gear policy: `lib/oci/outbox/process-outbox.ts`, `lib/oci/single-conversion-highest-only.ts`
- Producer: `lib/oci/enqueue-panel-stage-outbox.ts`
