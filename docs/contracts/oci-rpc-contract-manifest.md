# OCI RPC Contract Manifest

This manifest is the production source of truth for OCI-critical RPC contracts.

## Required RPCs

- `apply_call_action_v2`
  - Critical path: intent/call status mutations
  - Expected behavior: atomic action + outbox side effects
- `finalize_outbox_event_v1`
  - Critical path: outbox worker terminalization/retry
  - Expected behavior: deterministic `PENDING|PROCESSING|PROCESSED|FAILED`
- `ensure_session_intent_v1`
  - Critical path: session single-card upsert
  - Expected behavior: advisory lock + upsert semantics
- `append_script_claim_transition_batch`
  - Critical path: script export claim (`QUEUED|RETRY -> PROCESSING`)
- `append_script_transition_batch`
  - Critical path: script ack/ack-failed batch transitions
- `append_worker_transition_batch_v2`
  - Critical path: worker upload lifecycle transitions
- `claim_outbox_events`
  - Critical path: outbox claim with lock semantics
- `claim_offline_conversion_jobs_v3`
  - Critical path: queue claim for worker lane
- `register_ack_receipt_v1`
  - Critical path: ack idempotency / replay safety
- `complete_ack_receipt_v1`
  - Critical path: ack completion finalization

## Required SQL Contracts

- `calls_site_intent_stamp_uniq` unique constraint
- click intent stamp canonicalization trigger/function
- active single-card session invariant query contract
- queue external-id uniqueness guard for active rows
- reversal-voiding trigger for pending queue rows

## Gate Policy

Release is blocked when any of the following is true:

- runtime can call an RPC not present in contract catalog
- contract catalog RPC is not resolvable in DB
- schema/migration parity check fails
- strict OCI readiness gate fails
