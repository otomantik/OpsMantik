# ADR: Optional pre-insert dedupe for `outbox_events` (IntentSealed)

## Status

Implemented — partial unique index `idx_outbox_events_pending_site_call_stage_uq` (migration `20261226000000_oci_transition_grants_revoke_apply_call_action_strict.sql`); producer treats Postgres **23505** on insert as **idempotent success** (`outboxInserted: true`, metric `panel_stage_outbox_insert_prededupe_idempotent_total`).

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
- Producer must treat conflict as **success** (row already queued) and still return **`outboxInserted: true`** so panel `queued` / notify gating stay consistent (`enqueue-panel-stage-outbox.ts`).

## Links

- Worker gear policy: `lib/oci/outbox/process-outbox.ts`, `lib/oci/single-conversion-highest-only.ts`
- Producer: `lib/oci/enqueue-panel-stage-outbox.ts`
