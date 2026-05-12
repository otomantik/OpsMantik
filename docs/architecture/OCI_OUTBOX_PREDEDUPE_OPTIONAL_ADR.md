# ADR: Optional outbox pre-dedupe (Faz 6 / plan “Önceki Faz 6”)

## Context

Under burst operator activity, **multiple `outbox_events` rows** can exist for the same `(site_id, call_id, payload.stage)` while `PENDING`. The worker remains correct via idempotency and gear rank, but **queue depth and processing cost** grow.

## Decision (current)

1. **App-level:** `23505` on a partial unique / dedupe index is treated as **idempotent success** where implemented (`isOutboxPrededupeConflict` in [`lib/oci/enqueue-panel-stage-outbox.ts`](../../lib/oci/enqueue-panel-stage-outbox.ts)); metric `panel_stage_outbox_insert_prededupe_idempotent_total`.
2. **DB-level partial unique index** (same call + stage + `PENDING` only) is **optional**: Postgres partial unique indexes must be designed so terminal rows do not block legitimate re-entries — requires explicit `WHERE status = 'PENDING'` and careful migration with backfill of duplicates.

## Status

**Accepted as optional hardening.** Enable a DB partial unique index only after:

- Live duplicate count audit per site (T10 evidence),
- Worker claim semantics reviewed for same-call multi-row edge cases,
- Rollout behind feature flag or maintenance window.

## Alternatives considered

- **Worker-only coalescing:** no schema change; higher outbox cardinality.
- **Insert-before SELECT:** race-prone; inferior to unique index + `23505` idempotency.

## Links

- Troubleshooting: [`docs/runbooks/OCI_SSOT_TROUBLESHOOTING.md`](../runbooks/OCI_SSOT_TROUBLESHOOTING.md)
- Producer invariant tests: [`tests/architecture/oci-outbox-producer-invariant.test.ts`](../../tests/architecture/oci-outbox-producer-invariant.test.ts)
