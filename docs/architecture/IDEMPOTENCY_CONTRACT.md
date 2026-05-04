# Idempotency Contract (Core Spine)

This document pins where duplicate work is prevented across ingest, panel, and OCI.
Every PR that adds a writer path or retry path must update this contract.

## Contract Boundaries

- OCI producer identity
  - Mechanism: panel mutation must end with either `outbox_events` PENDING row or idempotent `oci_reconciliation_events` row (explicit skip reason). HTTP responses expose `oci_enqueue_ok`, `oci_outbox_inserted`, `oci_reconciliation_persisted`, and `oci_reconciliation_reason` (canonical reason when no outbox insert).
  - Dedupe: `oci_reconciliation_events` unique on evidence hash → Postgres `23505` is treated as successful idempotent persist (no throw from `appendOciReconciliationEvent`).
  - Owner: `enqueuePanelStageOciOutbox`; audit failures increment `panel_stage_reconciliation_persist_failed_total`.
- Marketing signal ingest
  - Mechanism: `idempotency_key` + unique violation collapse.
  - Owner: `upsertMarketingSignal`.
- Same call to second OCI queue row
  - Mechanism: `UNIQUE(call_id)` on `offline_conversion_queue` (`23505` -> skip).
  - Owner: `enqueueSealConversion`.
- Outbox worker parallelism
  - Mechanism: claim RPC flips `PENDING -> PROCESSING` atomically (`attempt_count` bump, `processing_started_at` stamp) + `FOR UPDATE SKIP LOCKED`.
  - Owner: `lib/oci/outbox/process-outbox.ts`.
- Funnel ledger replay
  - Mechanism: `idempotency_key` unique on `call_funnel_ledger`.
  - Owner: `appendFunnelEvent`.
- Truth canonical shadow
  - Mechanism: `(site_id, idempotency_key)` duplicate = success.
  - Owner: `appendCanonicalTruthLedger`.
- Google Ads upload
  - Mechanism: deterministic `external_id` + route-level ACK receipts.
  - Owner: `lib/oci/runner.ts`, `app/api/oci/ack/route.ts`, `app/api/oci/ack-failed/route.ts`.

## ACK Receipt Lifecycle (Required Invariant)

- State model (DB-authoritative)
  - `EMPTY`: no receipt row exists.
  - `REGISTERED`: first request reserved the logical receipt slot.
  - `APPLIED`: side effects finished and immutable `result_snapshot` is frozen.
- Determinism rule
  - A replay for an `APPLIED` receipt must return the same `result_snapshot`.
  - A replay for a `REGISTERED` receipt must not execute side effects again.
- Liveness rule
  - Any receipt that reaches `REGISTERED` must converge to `APPLIED` or explicit operator intervention.

## Partial-Write Notes

- `enqueueSealConversion` inserts the queue row first. Queue insert remains the money gate.
- Outbox and ACK flows are fail-closed. Any finalize/ledger failure must surface as an error, not a silent success.
- Manual deterministic drain is worker-first (`POST /api/workers/oci/process-outbox` + `x-opsmantik-internal-worker: 1` + `Bearer CRON_SECRET`); cron endpoint remains safety-net lock path.

## Required Evidence

- Formal spec: `specs/invariants/tla/InvariantCrucible.tla` and `.cfg`.
- Runtime gate: chaos tests + OCI kernel tests must pass before release.
- Deploy gate: `npm run smoke:intent-multi-site` is mandatory.

## Related

- [`MVP_TIER0_ROUTES.md`](./MVP_TIER0_ROUTES.md)
- [`OCI_THREAT_MODEL.md`](./OCI_THREAT_MODEL.md)
