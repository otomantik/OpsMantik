# Legacy Contract Resurrection Map

This map tracks critical contracts that previously existed in deleted migrations and are now restored by contract identity.

## Contract Families

## 1) Session Single-Card / Intent Dedupe
- Legacy lineage:
  - `calls intent_stamp uniqueness`
  - `ensure_session_intent_v1`
- Restored by:
  - `20260428143000_restore_intent_idempotency_contracts.sql`
  - `20260429160000_session_single_card_invariant.sql`

## 2) Outbox + Queue Atomic Lifecycle
- Legacy lineage:
  - outbox claim/finalize batch semantics
  - worker/script transition batch semantics
- Restored by:
  - baseline v2 + runtime compatibility migrations
  - contract-gated runtime checks in `scripts/ci/verify-db.mjs`

## 3) ACK Receipt Idempotency
- Legacy lineage:
  - register/complete ack receipt state machine
  - replay-in-progress protection
- Restored by:
  - ack receipt runtime contracts (`lib/oci/ack-receipt.ts`)
  - migration contract gating (contract-id checks)

## 4) External ID + Reversal Voiding
- Legacy lineage:
  - deterministic `external_id`
  - pending queue void on reversal actions
- Restored by:
  - current queue/reversal migration stack
  - release gate checks for queue lifecycle proofs

## Resurrection Rule

We do not trust timestamp file names as the durable contract identity.
We trust `contract-id` entries and enforce them via CI gates.
